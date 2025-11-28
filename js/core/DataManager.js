import { parseCsv } from '../utils/helpers.js';

export class DataManager {
  constructor() {
    this.data = [];
    this.lastUpdated = null;
  }

  async loadData(config) {
    try {
      // Attempt to fetch last updated time
      this.fetchLastUpdated();

      const response = await fetch(config.dataUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Failed to fetch data from ${config.dataUrl}: ${response.status}`);
      }

      let rawData;
      if (config.dataType === 'csv') {
        const text = await response.text();
        rawData = parseCsv(text);
      } else {
        rawData = await response.json();
      }

      // Normalize the data using the specific configuration's processor
      this.data = config.processFn(rawData);
      return this.data;
    } catch (error) {
      console.error("DataManager loadData error:", error);
      throw error;
    }
  }

  async fetchLastUpdated() {
    try {
      const response = await fetch("data/last_updated.txt", { cache: "no-store" });
      if (response.ok) {
        this.lastUpdated = (await response.text()).trim();
      } else {
        this.lastUpdated = null;
      }
    } catch (e) {
      console.warn("Could not fetch last_updated.txt");
      this.lastUpdated = null;
    }
  }

  getData() {
    return this.data;
  }
}
