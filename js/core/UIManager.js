export class UIManager {
  constructor(containerIds) {
    this.filterContainer = document.getElementById(containerIds.filters);
    this.tableBody = document.getElementById(containerIds.table);
    this.tableHeader = document.getElementById(containerIds.header);
    this.statusElement = document.getElementById(containerIds.status);
    this.lastUpdatedElement = document.getElementById(containerIds.lastUpdated);
    this.activeTags = new Set();
    this.filterCallback = null;
    this.currentFilters = []; // [{ type, field, element, ... }]
  }

  init(config, data, onFilterChange) {
    this.filterCallback = onFilterChange;
    this.renderFilters(config.filters, data);
    this.renderHeaders(config.columns);
    this.updateLastUpdated(config.lastUpdated);
  }

  updateLastUpdated(text) {
    if (this.lastUpdatedElement) {
      this.lastUpdatedElement.textContent = text || "Unknown";
    }
  }

  renderHeaders(columns) {
    if (!this.tableHeader) return;
    this.tableHeader.innerHTML = '';
    columns.forEach(col => {
      const th = document.createElement('th');
      th.textContent = col.header;
      this.tableHeader.appendChild(th);
    });
  }

  renderFilters(filterDefs, data) {
    this.filterContainer.innerHTML = '';
    this.currentFilters = [];
    this.activeTags.clear();

    filterDefs.forEach(def => {
      const wrapper = document.createElement('div');
      wrapper.className = `filter-group filter-${def.type}`;
      
      // Label
      if (def.label) {
        const label = document.createElement('label');
        label.textContent = def.label;
        label.className = "filter-label";
        wrapper.appendChild(label);
      }

      let element;

      if (def.type === 'search') {
        element = document.createElement('input');
        element.type = 'text';
        element.placeholder = def.placeholder || 'Search...';
        element.className = 'form-input search-input';
        element.addEventListener('input', () => this.handleInput());
      } 
      else if (def.type === 'select') {
        element = document.createElement('select');
        element.className = 'form-select';
        element.innerHTML = `<option value="">${def.placeholder || 'All'}</option>`;
        
        // Populate options
        const values = new Set();
        data.forEach(row => {
          const val = row[def.field];
          if (val) values.add(val);
        });
        
        // Helper for sorting options (restaurant areas have complex sorting, but let's keep it simple generic sort for now or allow passing a sorter)
        const sortedValues = [...values].sort((a, b) => a.toString().localeCompare(b.toString()));
        
        sortedValues.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v;
            opt.textContent = v;
            element.appendChild(opt);
        });
        
        element.addEventListener('change', () => this.handleInput());
      }
      else if (def.type === 'number') {
        element = document.createElement('input');
        element.type = 'number';
        element.placeholder = def.placeholder || '';
        element.className = 'form-input number-input';
        element.addEventListener('input', () => this.handleInput());
      }
      else if (def.type === 'tags') {
        element = document.createElement('div');
        element.className = 'tag-container';
        
        const tags = new Set();
        data.forEach(row => {
           if (Array.isArray(row[def.field])) {
             row[def.field].forEach(t => tags.add(t));
           }
        });

        [...tags].sort().forEach(tag => {
           const chip = document.createElement('button');
           chip.type = 'button';
           chip.className = 'chip';
           chip.textContent = tag;
           chip.dataset.tag = tag;
           chip.addEventListener('click', () => {
             this.toggleTag(tag, chip);
             this.handleInput();
           });
           element.appendChild(chip);
        });
      }

      wrapper.appendChild(element);
      this.filterContainer.appendChild(wrapper);

      // Store reference for retrieving values later
      this.currentFilters.push({ ...def, element });
    });
  }

  toggleTag(tag, chipElement) {
    if (this.activeTags.has(tag)) {
      this.activeTags.delete(tag);
      chipElement.classList.remove('active');
      chipElement.setAttribute('aria-pressed', 'false');
    } else {
      this.activeTags.add(tag);
      chipElement.classList.add('active');
      chipElement.setAttribute('aria-pressed', 'true');
    }
  }

  handleInput() {
    if (this.filterCallback) {
      this.filterCallback();
    }
  }

  getFilterValues() {
    const values = {};
    this.currentFilters.forEach(f => {
      if (f.type === 'tags') {
        values[f.field] = [...this.activeTags];
      } else {
        values[f.field] = f.element.value;
      }
    });
    return values;
  }

  renderTable(rows, columns) {
    this.tableBody.innerHTML = '';

    if (rows.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = columns.length;
      td.textContent = "No results found.";
      td.style.textAlign = "center";
      td.style.padding = "2rem";
      tr.appendChild(td);
      this.tableBody.appendChild(tr);
      return;
    }

    rows.forEach(row => {
      const tr = document.createElement('tr');
      
      columns.forEach(col => {
        const td = document.createElement('td');
        
        let content = row[col.field];
        
        if (col.format) {
           content = col.format(content, row);
        } else if (content === null || content === undefined) {
           content = '–';
        }

        if (col.isLink) {
            const a = document.createElement('a');
            a.href = row.mapUrl || '#';
            a.target = "_blank";
            a.rel = "noopener";
            a.textContent = content || '(No Title)';
            td.appendChild(a);
        } else {
            td.textContent = content;
        }
        
        tr.appendChild(td);
      });
      
      this.tableBody.appendChild(tr);
    });
  }

  updateStatus(message) {
    if (this.statusElement) {
      this.statusElement.textContent = message;
    }
  }
}
