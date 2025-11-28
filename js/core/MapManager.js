export class MapManager {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.map = null;
    this.markers = [];
    this.infoWindow = null;
    // Defaults, can be overridden per config if needed, or set via `setCenter`
    this.defaultCenter = { lat: 35.6895, lng: 139.6917 }; 
    this.defaultZoom = 12;
  }

  init(center, zoom) {
    if (!this.container) return;
    if (typeof window.google === "undefined" || !window.google.maps) return;

    if (center) this.defaultCenter = center;
    if (zoom) this.defaultZoom = zoom;

    this.map = new google.maps.Map(this.container, {
      center: this.defaultCenter,
      zoom: this.defaultZoom,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });

    this.infoWindow = new google.maps.InfoWindow();
  }

  updateMarkers(items, contentGenerator) {
    if (!this.map) return;

    this.clearMarkers();

    const bounds = new google.maps.LatLngBounds();
    let hasMarker = false;

    items.forEach((item) => {
      if (!item.hasCoordinates) return;

      const position = { lat: item.lat, lng: item.lng };
      const marker = new google.maps.Marker({
        map: this.map,
        position,
        title: item.title,
      });

      marker.addListener("click", () => {
        if (this.infoWindow) {
          this.infoWindow.close();
          this.infoWindow.setContent(contentGenerator(item));
          this.infoWindow.open({ anchor: marker, map: this.map });
        }
      });

      this.markers.push(marker);
      bounds.extend(position);
      hasMarker = true;
    });

    if (!hasMarker) {
      this.map.setCenter(this.defaultCenter);
      this.map.setZoom(this.defaultZoom);
      return;
    }

    if (this.markers.length === 1) {
      this.map.setCenter(bounds.getCenter());
      this.map.setZoom(16);
    } else {
      this.map.fitBounds(bounds, 50);
    }
  }

  clearMarkers() {
    this.markers.forEach((marker) => marker.setMap(null));
    this.markers = [];
    if (this.infoWindow) {
      this.infoWindow.close();
    }
  }
}
