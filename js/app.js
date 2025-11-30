import { MapManager } from './core/MapManager.js';
import { DataManager } from './core/DataManager.js';
import { UIManager } from './core/UIManager.js';
import { isIOS } from './utils/helpers.js';

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

    // Bind "Find Me" button
    const findMeBtn = document.getElementById('find-me-btn');
    if (findMeBtn) {
      findMeBtn.addEventListener('click', () => this.handleFindMe(findMeBtn));
    }
  }

  async handleFindMe(button) {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }

    const originalText = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-spin">
        <line x1="12" y1="2" x2="12" y2="6"></line>
        <line x1="12" y1="18" x2="12" y2="22"></line>
        <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
        <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
        <line x1="2" y1="12" x2="6" y2="12"></line>
        <line x1="18" y1="12" x2="22" y2="12"></line>
        <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
        <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
      </svg> Locating...`;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        this.mapManager.showUserLocation(latitude, longitude);
        button.innerHTML = originalText;
        button.disabled = false;
      },
      (error) => {
        console.error("Error getting location:", error);
        alert("Unable to retrieve your location.");
        button.innerHTML = originalText;
        button.disabled = false;
      },
      { timeout: 10000, maximumAge: 60000, enableHighAccuracy: true }
    );
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
        
        if (!isIOS()) {
            title.target = "_blank";
            title.rel = "noopener";
        }
        
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
