/********************************************************************************
 * Copyright (c) 2019 EclipseSource and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/
import { inject, injectable, multiInject, optional } from "inversify";
import { Action, ILogger, isSelected, SModelElement, SModelRoot, TYPES } from "sprotty";

import { SModelRootListener } from "../../base/model/update-model-command";
import { GLSP_TYPES } from "../../base/types";
import { distinctAdd, remove } from "../../utils/array-utils";
import { IFeedbackActionDispatcher } from "../tool-feedback/feedback-action-dispatcher";
import { SelectFeedbackAction } from "./action-definitions";

export interface SelectionListener {
    selectionChanged(root: Readonly<SModelRoot>, selectedElements: string[]): void;
}

@injectable()
export class SelectionService implements SModelRootListener {
    private root: Readonly<SModelRoot>;
    private selectedElementIDs: Set<string> = new Set();

    @inject(GLSP_TYPES.IFeedbackActionDispatcher) protected feedbackDispatcher: IFeedbackActionDispatcher;
    @inject(TYPES.ILogger) protected logger: ILogger;

    constructor(@multiInject(GLSP_TYPES.SelectionListener) @optional() protected selectionListeners: SelectionListener[] = []) { }

    register(selectionListener: SelectionListener) {
        distinctAdd(this.selectionListeners, selectionListener);
    }

    deregister(selectionListener: SelectionListener) {
        remove(this.selectionListeners, selectionListener);
    }

    modelRootChanged(root: Readonly<SModelRoot>): void {
        this.updateSelection(root, [], []);
    }

    updateSelection(root: Readonly<SModelRoot>, select: string[], deselect: string[]) {
        if (root === undefined && select.length === 0 && deselect.length === 0) {
            return;
        }
        const prevRoot = this.root;
        const prevSelectedElementIDs = new Set(this.selectedElementIDs);

        // update root
        this.root = root;

        // update selected element IDs and collect deselected elements
        // - select all elements that are not deselected at the same time (no-op)
        // - deselect all elements that are not selected at the same time (no-op) but was selected
        const toSelect = [...select].filter(selectId => deselect.indexOf(selectId) === -1);
        const toDeselect = [...deselect].filter(deselectId => select.indexOf(deselectId) === -1 && this.selectedElementIDs.has(deselectId));
        for (const id of toDeselect) {
            this.selectedElementIDs.delete(id);
        }
        for (const id of toSelect) {
            this.selectedElementIDs.add(id);
        }

        const deselectedElementIDs = new Set(toDeselect);
        // see if selected elements still exist in the updated root
        for (const id of this.selectedElementIDs) {
            const element = root.index.getById(id);
            if (element === undefined) {
                this.selectedElementIDs.delete(id);
                if (prevRoot !== undefined && prevRoot.index.getById(id)) {
                    deselectedElementIDs.add(id);
                }
            }
        }

        // only send out changes if there actually are changes, i.e., the root or the selected elements changed
        const selectionChanged = prevSelectedElementIDs.size !== this.selectedElementIDs.size || ![...prevSelectedElementIDs].every(value => this.selectedElementIDs.has(value));
        if (selectionChanged) {
            // aggregate to feedback action handling all elements as only the last feedback is restored
            this.dispatchFeedback([new SelectFeedbackAction([...this.selectedElementIDs], [...deselectedElementIDs])]);
        }

        const rootChanged = prevRoot !== root;
        if (rootChanged || selectionChanged) {
            // notify listeners after the feedback action
            this.notifyListeners(this.root, this.selectedElementIDs);
        }
    }

    dispatchFeedback(actions: Action[]) {
        this.feedbackDispatcher.registerFeedback(this, actions);
    }

    notifyListeners(root: SModelRoot, selectedElementIDs: Set<string>) {
        this.selectionListeners.forEach(listener => listener.selectionChanged(root, Array.from(selectedElementIDs)));
    }

    getModelRoot(): Readonly<SModelRoot> {
        return this.root;
    }

    getSelectedElements(): Readonly<SModelElement>[] {
        return Array.from(this.root.index.all().filter(isSelected));
    }

    /**
     * QUERY METHODS
     */

    getSelectedElementIDs(): Set<string> {
        return this.selectedElementIDs;
    }

    hasSelectedElements(): boolean {
        return this.selectedElementIDs.size > 0;
    }

    isSingleSelection(): boolean {
        return this.selectedElementIDs.size === 1;
    }

    isMultiSelection(): boolean {
        return this.selectedElementIDs.size > 1;
    }
}
