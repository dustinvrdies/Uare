/**
 * ENKI PART EDITOR UI
 * Hierarchical selection and editing: part-level, subsystem-level, assembly-level
 * ═══════════════════════════════════════════════════════════════════════════
 */

export class EnkiPartEditor {
  constructor(assembly, onEditCallback) {
    this.assembly = assembly;
    this.onEditCallback = onEditCallback;
    this.selectedParts = new Set();
    this.editMode = 'none';  // 'part' | 'subsystem' | 'assembly'
    this.dragSelection = false;
  }

  /**
   * Build the edit UI panel HTML
   */
  buildEditPanel() {
    const html = `
      <div id="enki-edit-panel" class="edit-panel">
        <div class="edit-header">
          <h3>🔧 Design Editor</h3>
          <div class="edit-mode-selector">
            <button class="mode-btn" data-mode="part" title="Edit single part">Part</button>
            <button class="mode-btn" data-mode="subsystem" title="Edit subsystem">Subsystem</button>
            <button class="mode-btn" data-mode="assembly" title="Edit whole assembly">Assembly</button>
          </div>
        </div>

        <div id="edit-selection-panel" class="selection-panel">
          <div class="selection-info">
            <span id="selected-count">0 parts selected</span>
            <button id="clear-selection-btn" class="clear-btn">Clear</button>
          </div>
          <div id="selected-parts-list" class="parts-list"></div>
        </div>

        <div id="edit-properties-panel" class="properties-panel">
          <div class="properties-header">
            <h4>Edit Properties</h4>
          </div>
          <div id="editable-fields-container" class="fields-container">
            <!-- Fields will be populated here based on selected parts -->
          </div>
          <div class="properties-footer">
            <button id="apply-edits-btn" class="apply-btn">Apply Changes</button>
            <button id="cancel-edits-btn" class="cancel-btn">Cancel</button>
          </div>
        </div>

        <div id="dependencies-panel" class="dependencies-panel hidden">
          <h4>Affected Parts</h4>
          <p>These parts will be recomputed:</p>
          <ul id="affected-parts-list"></ul>
        </div>

        <div id="edit-suggestions-panel" class="suggestions-panel hidden">
          <h4>💡 Edit Suggestions</h4>
          <div id="suggestions-list"></div>
        </div>
      </div>

      <style>
        #enki-edit-panel {
          background: linear-gradient(135deg, #0f1419 0%, #1a2530 100%);
          border: 1px solid rgba(100, 150, 200, 0.3);
          border-radius: 8px;
          padding: 16px;
          font-family: 'Segoe UI', sans-serif;
          color: #dcecff;
          max-height: 600px;
          overflow-y: auto;
        }

        .edit-header {
          margin-bottom: 16px;
          border-bottom: 1px solid rgba(100, 150, 200, 0.2);
          padding-bottom: 12px;
        }

        .edit-header h3 {
          margin: 0 0 10px 0;
          font-size: 16px;
          font-weight: 600;
        }

        .edit-mode-selector {
          display: flex;
          gap: 8px;
        }

        .mode-btn {
          flex: 1;
          padding: 8px 12px;
          background: rgba(50, 80, 120, 0.5);
          border: 1px solid rgba(100, 150, 200, 0.3);
          color: #a8c8ff;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
          transition: all 0.2s;
        }

        .mode-btn:hover {
          background: rgba(60, 100, 150, 0.7);
          border-color: rgba(150, 200, 255, 0.5);
        }

        .mode-btn.active {
          background: rgba(100, 150, 220, 0.8);
          border-color: rgba(150, 200, 255, 0.8);
          color: #fff;
        }

        .selection-panel {
          margin-bottom: 16px;
          padding: 12px;
          background: rgba(20, 40, 70, 0.5);
          border-radius: 4px;
        }

        .selection-info {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
          font-size: 12px;
        }

        .clear-btn {
          padding: 4px 12px;
          background: rgba(200, 80, 80, 0.5);
          border: 1px solid rgba(220, 100, 100, 0.5);
          color: #ffb8b8;
          border-radius: 3px;
          cursor: pointer;
          font-size: 11px;
        }

        .clear-btn:hover {
          background: rgba(220, 100, 100, 0.7);
        }

        .parts-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          max-height: 80px;
          overflow-y: auto;
        }

        .part-chip {
          display: inline-block;
          padding: 4px 10px;
          background: rgba(100, 150, 200, 0.6);
          border: 1px solid rgba(150, 200, 255, 0.6);
          border-radius: 20px;
          font-size: 11px;
          color: #fff;
          cursor: pointer;
          white-space: nowrap;
        }

        .part-chip:hover {
          background: rgba(120, 170, 220, 0.8);
        }

        .part-chip .remove-btn {
          margin-left: 6px;
          cursor: pointer;
          color: #ffb8b8;
        }

        .properties-panel {
          margin-bottom: 16px;
          padding: 12px;
          background: rgba(20, 40, 70, 0.5);
          border-radius: 4px;
        }

        .properties-header h4 {
          margin: 0 0 12px 0;
          font-size: 13px;
          font-weight: 600;
          color: #a8c8ff;
        }

        .fields-container {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          margin-bottom: 12px;
        }

        .field-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .field-label {
          font-size: 11px;
          color: #88bbff;
          font-weight: 500;
        }

        .field-input {
          padding: 6px 8px;
          background: rgba(10, 20, 40, 0.8);
          border: 1px solid rgba(100, 150, 200, 0.4);
          color: #dcecff;
          border-radius: 3px;
          font-size: 12px;
        }

        .field-input:focus {
          outline: none;
          border-color: rgba(150, 200, 255, 0.8);
          background: rgba(20, 40, 70, 0.9);
        }

        .properties-footer {
          display: flex;
          gap: 8px;
        }

        .apply-btn,
        .cancel-btn {
          flex: 1;
          padding: 8px 12px;
          border-radius: 4px;
          border: 1px solid;
          font-weight: 500;
          cursor: pointer;
          font-size: 12px;
          transition: all 0.2s;
        }

        .apply-btn {
          background: rgba(80, 180, 100, 0.6);
          border-color: rgba(120, 220, 150, 0.6);
          color: #b8ffcc;
        }

        .apply-btn:hover {
          background: rgba(100, 200, 120, 0.8);
        }

        .cancel-btn {
          background: rgba(120, 120, 120, 0.4);
          border-color: rgba(150, 150, 150, 0.4);
          color: #ccc;
        }

        .cancel-btn:hover {
          background: rgba(150, 150, 150, 0.6);
        }

        .dependencies-panel,
        .suggestions-panel {
          margin-top: 12px;
          padding: 12px;
          background: rgba(30, 60, 100, 0.4);
          border: 1px solid rgba(100, 150, 200, 0.2);
          border-radius: 4px;
          font-size: 12px;
        }

        .dependencies-panel.hidden,
        .suggestions-panel.hidden {
          display: none;
        }

        .dependencies-panel h4,
        .suggestions-panel h4 {
          margin: 0 0 8px 0;
          font-size: 12px;
          font-weight: 600;
          color: #a8c8ff;
        }

        .affected-parts-list,
        .suggestions-list {
          list-style: none;
          margin: 0;
          padding: 0;
        }

        .affected-parts-list li,
        .suggestion-item {
          padding: 4px 0;
          border-bottom: 1px solid rgba(100, 150, 200, 0.1);
          font-size: 11px;
          color: #b8d0ff;
        }

        .affected-parts-list li:last-child,
        .suggestion-item:last-child {
          border-bottom: none;
        }

        .suggestion-item {
          padding: 6px 8px;
          background: rgba(100, 150, 200, 0.1);
          margin-bottom: 4px;
          border-radius: 3px;
          border: 1px solid rgba(100, 150, 200, 0.2);
        }
      </style>
    `;
    return html;
  }

  /**
   * Register event listeners and initialize UI
   */
  bindUI(containerSelector) {
    const container = document.querySelector(containerSelector);
    if (!container) return;

    container.innerHTML = this.buildEditPanel();

    // Mode buttons
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.editMode = btn.dataset.mode;
      });
    });

    // Clear selection
    document.getElementById('clear-selection-btn').addEventListener('click', () => {
      this.selectedParts.clear();
      this.updateSelectionDisplay();
    });

    // Apply edits
    document.getElementById('apply-edits-btn').addEventListener('click', () => {
      this._applyEdits();
    });

    document.getElementById('cancel-edits-btn').addEventListener('click', () => {
      this.selectedParts.clear();
      this.updateSelectionDisplay();
    });
  }

  /**
   * User clicks on a part in 3D viewport → select/deselect it
   */
  selectPart(partId, multiSelect = false) {
    if (!multiSelect) {
      this.selectedParts.clear();
    }

    if (this.selectedParts.has(partId)) {
      this.selectedParts.delete(partId);
    } else {
      this.selectedParts.add(partId);
    }

    this.updateSelectionDisplay();
  }

  /**
   * Select an entire subsystem
   */
  selectSubsystem(subsystemId) {
    const subsystem = this.assembly.subsystems?.find((s) => s.id === subsystemId);
    if (!subsystem) return;

    this.selectedParts.clear();
    subsystem.parts?.forEach((partId) => this.selectedParts.add(partId));
    this.editMode = 'subsystem';

    this.updateSelectionDisplay();
  }

  /**
   * Update UI to show selected parts and editable fields
   */
  updateSelectionDisplay() {
    // Update count
    const countEl = document.getElementById('selected-count');
    if (countEl) countEl.textContent = `${this.selectedParts.size} part(s) selected`;

    // Update parts list
    const listEl = document.getElementById('selected-parts-list');
    if (listEl) {
      listEl.innerHTML = Array.from(this.selectedParts)
        .map((partId) => {
          const part = this.assembly.parts?.find((p) => p.id === partId);
          return `
          <span class="part-chip" data-id="${partId}">
            ${part?.name || partId}
            <span class="remove-btn">×</span>
          </span>
        `;
        })
        .join('');

      listEl.querySelectorAll('.part-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          this.selectPart(chip.dataset.id, true);
        });
      });
    }

    // Update editable fields
    this._updateEditableFields();

    // Show dependent parts
    this._updateAffectedParts();
  }

  /**
   * Generate form fields for editable properties
   */
  _updateEditableFields() {
    const container = document.getElementById('editable-fields-container');
    if (!container) return;

    if (this.selectedParts.size === 0) {
      container.innerHTML = '<p style="font-size: 12px; color: #888;">Select parts to edit</p>';
      return;
    }

    const parts = Array.from(this.selectedParts)
      .map((id) => this.assembly.parts?.find((p) => p.id === id))
      .filter(Boolean);

    // Common editable fields
    const commonFields = ['diameter', 'length', 'width', 'height', 'thickness', 'material', 'surface_finish'];

    let html = '';
    commonFields.forEach((field) => {
      const part = parts[0];  // use first selected part as template
      const value = this._getPartFieldValue(part, field);
      if (value !== null && value !== undefined) {
        html += `
          <div class="field-group">
            <label class="field-label">${field}</label>
            <input
              class="field-input editable-field"
              data-field="${field}"
              type="text"
              value="${String(value)}"
              placeholder="(no change)"
            />
          </div>
        `;
      }
    });

    container.innerHTML = html || '<p style="font-size: 12px; color: #888;">No editable fields</p>';
  }

  /**
   * Get current value of a field from a part
   */
  _getPartFieldValue(part, field) {
    if (!part) return null;

    // Check nested properties
    if (part.dims?.[field]) return part.dims[field];
    if (part[field]) return part[field];
    if (part.manufacturing?.[field]) return part.manufacturing[field];
    if (part.tolerances?.[field]) return part.tolerances[field];
    if (part.engineering?.[field]) return part.engineering[field];

    return null;
  }

  /**
   * Show affected parts that will be recomputed
   */
  _updateAffectedParts() {
    const panel = document.getElementById('dependencies-panel');
    const list = document.getElementById('affected-parts-list');
    if (!panel || !list || this.selectedParts.size === 0) return;

    // Placeholder: in real impl, use EditDependencyTracker
    const affectedIds = new Set();
    Array.from(this.selectedParts).forEach((partId) => {
      const part = this.assembly.parts?.find((p) => p.id === partId);
      if (part?.dependent_edits) {
        Object.values(part.dependent_edits).forEach((ids) => {
          ids?.forEach((id) => affectedIds.add(id));
        });
      }
    });

    if (affectedIds.size > 0) {
      panel.classList.remove('hidden');
      list.innerHTML = Array.from(affectedIds)
        .map((id) => {
          const part = this.assembly.parts?.find((p) => p.id === id);
          return `<li>• ${part?.name || id}</li>`;
        })
        .join('');
    } else {
      panel.classList.add('hidden');
    }
  }

  /**
   * Collect edits from form and call callback
   */
  _applyEdits() {
    const edits = {};

    document.querySelectorAll('.editable-field').forEach((input) => {
      const field = input.dataset.field;
      const value = input.value.trim();
      if (value) {
        edits[field] = isNaN(value) ? value : Number(value);
      }
    });

    if (Object.keys(edits).length === 0) {
      alert('No changes made');
      return;
    }

    // Call the callback with affected parts list
    const affectedPartIds = Array.from(this.selectedParts);
    this.onEditCallback({
      edit_mode: this.editMode,
      selected_parts: affectedPartIds,
      edits: edits,
      timestamp: new Date().toISOString(),
    });
  }
}

export default { EnkiPartEditor };
