import { MapManager } from './core/MapManager.js';
import { DataManager } from './core/DataManager.js';
import { UIManager } from './core/UIManager.js';

import { tokyoConfig } from './config/tokyo.js';
import { kyotoConfig } from './config/kyoto.js';
import { hachipayConfig } from './config/hachipay.js';

const configs = {
  tokyo: tokyoConfig,
  kyoto: kyotoConfig,
  hachipay: hachipayConfig
};

class App {
  constructor() {
    this.mapManager = new MapManager('map');
    this.dataManager = new DataManager();
    this.uiManager = new UIManager({
      filters: 'filters',
      table: 'table-body',
      header: 'table-header',
      status: 'status-message',
      lastUpdated: 'last-updated'
    });
    
    this.currentConfig = null;
    this.allData = [];
    this.filteredData = [];
    
    // Expose to global for Google Maps callback
    window.initMap = () => {
      if (this.currentConfig) {
          this.mapManager.init(this.currentConfig.mapCenter, this.currentConfig.mapZoom);
          // If data is already loaded, update markers
          if (this.filteredData.length > 0) {
            this.updateMap();
          }
      } else {
          this.mapManager.init(); 
      }
    };
  }

  async init() {
    // Bind tab switching
    const buttons = document.querySelectorAll('.tab-button');
    buttons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.target.dataset.target;
        if (target === this.currentConfig?.id) return;

        this.switchContext(target);
        
        // Update active tab state
        buttons.forEach(b => {
            b.classList.remove('active');
            b.setAttribute('aria-selected', 'false');
        });
        e.target.classList.add('active');
        e.target.setAttribute('aria-selected', 'true');
      });
    });

    // Default to Tokyo (or check URL hash?)
    // Let's default to Tokyo for now.
    await this.switchContext('tokyo');
  }

  async switchContext(configId) {
    const config = configs[configId];
    if (!config) return;

    this.currentConfig = config;
    this.uiManager.updateStatus('Loading data...');
    this.uiManager.renderTable([], []); // Clear table
    this.mapManager.clearMarkers();

    try {
      this.allData = await this.dataManager.loadData(config);
      
      // Initialize UI Filters
      this.uiManager.init(config, this.allData, () => this.applyFilters());
      
      // Re-center map if map is ready
      if (this.mapManager.map) {
          this.mapManager.map.setCenter(config.mapCenter);
          this.mapManager.map.setZoom(config.mapZoom);
      }

      this.applyFilters();
      
    } catch (error) {
      console.error(error);
      this.uiManager.updateStatus(`Error loading data: ${error.message}`);
    }
  }

  applyFilters() {
    const filterValues = this.uiManager.getFilterValues();
    
    this.filteredData = this.allData.filter(item => {
      for (const filterDef of this.currentConfig.filters) {
        const value = filterValues[filterDef.field];
        
        if (filterDef.type === 'search') {
           if (value) {
             const keyword = value.toLowerCase();
             const match = filterDef.matchFields.some(field => {
               const fieldVal = item[field];
               if (Array.isArray(fieldVal)) return fieldVal.join(' ').toLowerCase().includes(keyword);
               return String(fieldVal || '').toLowerCase().includes(keyword);
             });
             if (!match) return false;
           }
        }
        else if (filterDef.type === 'select') {
           if (value && item[filterDef.field] !== value) return false;
        }
        else if (filterDef.type === 'number') {
           if (value !== '') {
               const numVal = parseFloat(value);
               const itemVal = item[filterDef.field];
               if (itemVal === null || itemVal === undefined) return false;
               if (filterDef.operator === '>=' && itemVal < numVal) return false;
               if (filterDef.operator === '<=' && itemVal > numVal) return false;
           }
        }
        else if (filterDef.type === 'tags') {
           // Value is array of active tags
           if (value && value.length > 0) {
              if (!value.every(tag => item[filterDef.field].includes(tag))) return false;
           }
        }
      }
      return true;
    });

    this.uiManager.renderTable(this.filteredData, this.currentConfig.columns);
    this.updateMap();
    this.uiManager.updateStatus(`${this.filteredData.length} of ${this.allData.length} shown`);
  }

  updateMap() {
    this.mapManager.updateMarkers(this.filteredData, (item) => {
        const div = document.createElement('div');
        div.className = 'map-info-window';
        div.style.display = 'flex';
        div.style.flexDirection = 'column';
        div.style.gap = '4px';

        const title = document.createElement('a');
        title.href = item.mapUrl;
        title.target = "_blank";
        title.rel = "noopener";
        title.style.fontWeight = "bold";
        title.style.color = "#1a73e8";
        title.textContent = item.title || "(No Title)";
        div.appendChild(title);

        if (item.category) {
            const cat = document.createElement('div');
            cat.textContent = item.category;
            cat.style.fontSize = "0.85em";
            cat.style.color = "#555";
            div.appendChild(cat);
        }

        if (item.area) {
            const area = document.createElement('div');
            area.textContent = item.area;
            area.style.fontSize = "0.85em";
            area.style.color = "#555";
            div.appendChild(area);
        }

        return div;
    });
  }
}

const app = new App();
document.addEventListener('DOMContentLoaded', () => app.init());
