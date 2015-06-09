(function($) {

  var $googleMapsAreas = $('.googlemaps-area');
  if($googleMapsAreas.length == 0) {
    return;
  }

  var DEFAULT_MAP_ZOOM = 1;
  var MAX_MAP_ZOOM = 12;
  var CLUSTER_MAX_ZOOM = MAX_MAP_ZOOM - 1;  // always less then MAX_MAP_ZOOM!

  var url_marker_details = new RegExp('^#!/marker/(\\d+)/?$');
  var url_country_details = new RegExp('^#!/country/(\\w+)/?$');

  // NOTE: these are now duplicated with "impactmap.py" in Python
  var CLUSTER_GRID_SIZE = 50;
  var CLUSTER_STYLES = [
    {
      url: '/static/frontend/img/impactmap/marker-16.png',
      width: 16,
      height: 16,
      textSize: 11,
      textColor: '#fdfdfd',
      min_lights: Number.NEGATIVE_INFINITY,  // 1-9
      marker_zoom: 7
    },
    {
      url: '/static/frontend/img/impactmap/cluster-30.png',
      width: 30,
      height: 30,
      textSize: 11,
      textColor: '#fdfdfd',
      min_lights: 10,
      marker_zoom: 7    // 2 digits
    },
    {
      url: '/static/frontend/img/impactmap/cluster-40.png',
      width: 41,
      height: 41,
      textSize: 13,
      textColor: '#fdfdfd',
      min_lights: 100,   // 3 digits
      marker_zoom: 7
    },
    {
      url: '/static/frontend/img/impactmap/cluster-60.png',
      width: 58,
      height: 58,
      textSize: 14,
      textColor: '#fdfdfd',
      min_lights: 1000,  // 4 digits
      marker_zoom: 5
    },
    {
      url: '/static/frontend/img/impactmap/cluster-70.png',
      width: 70,
      height: 70,
      textSize: 17,
      textColor: '#fdfdfd',
      min_lights: 10000,  // 5 digits
      marker_zoom: 5
    }
  ];

  // Make the CLUSTER_STYLES usable as marker icons too.
  var MARKER_ICONS = CLUSTER_STYLES;    // just editing the same object
  for(var i = 0; i < MARKER_ICONS.length; i++) {
    var icon = MARKER_ICONS[i];
    var cx = Math.floor(icon.width / 2);
    var cy = Math.floor(icon.height / 2);

    icon.size = new google.maps.Size(icon.width, icon.height);
    icon.anchor = new google.maps.Point(cx, cy);
    icon._labelAnchor = new google.maps.Point(cx, cy);   // is relative to anchor
    icon._labelStyle = {
      width: icon.width + "px",
      lineHeight: icon.height + 'px',
      fontSize: icon.textSize + "px",
      color: icon.textColor
    };
  }


  function MapPlugin(area, options)
  {
    this.$area = $(area);
    this.gmap = null;
    this.options = options;
    this.init();
  }

  MapPlugin.prototype =
  {
    init: function MapPlugin_init()
    {
      var map_content = JSON.parse(this.$area.find('script.googlemaps-data').text());

      // Update the settings
      var center = new google.maps.LatLng(this.options.centerLat || 0, this.options.centerLng || 0);
      this.options.defaultCenter = this.options.defaultCenter || center;

      // Initialize the main map
      this.gmap = new google.maps.Map(this.$area.find('.googlemaps-widget').get(0), {
        center: this.options.defaultCenter,
        mapTypeId: google.maps.MapTypeId[this.options.mapTypeId || "HYBRID"],

        // nice default settings for compact embedding:
        zoom: this.options.zoom != null ? this.options.zoom : DEFAULT_MAP_ZOOM,
        minZoom: this.options.minZoom != null ? this.options.minZoom : 1,
        maxZoom: this.options.maxZoom || 12,
        streetViewControl: this.options.streetViewControl || false,
        zoomControl: this.options.zoomControl != null ? this.options.zoomControl : true,
        zoomControlOptions: {
          style: google.maps.ZoomControlStyle[this.options.zoomControlStyle || "SMALL"]
        }
      });
      google.maps.event.addListener(this.gmap, 'click', $.proxy(this.onMapClick, this));
      google.maps.event.addListener(this.gmap, 'zoom_changed', $.proxy(this.onMapZoom, this));

      // Cluster manager
      if(this.options.showClusters) {
        this.markerCluster = new MarkerClusterer(this.gmap, [], {
          gridSize: CLUSTER_GRID_SIZE,
          maxZoom: CLUSTER_MAX_ZOOM,
          styles: CLUSTER_STYLES
        });
        this.markerCluster.setCalculator(_getClusterStyle);
      }
      else {
        this.gmarkers = [];
      }

      // Add overlay
      this.$zoomBack = this.$area.find(".zoom-back");
      this.$zoomBack.hide().find('a').click($.proxy(this.onZoomBackClick, this));
      this.gmap.controls[google.maps.ControlPosition.TOP_LEFT].insertAt(0, this.$zoomBack.get(0));

      // Add markers
      this.initMarkers(map_content);
    },

    initMarkers: function MapPlugin_initMarkers(groups)
    {
      this.clearMarkers();

      for(var i = 0; i < groups.length; i++) {
        var group = groups[i];
        var icon = _createIcon(group.icon);
        var gmarkers = this._jsonToMarkers(group.markers, icon);
        this.addMarkers(gmarkers);
      }
    },

    clearMarkers: function MapPlugin_clearMarkers()
    {
      if(this.options.showClusters) {
        // Remove everything loaded in the clusterer
        this.markerCluster.clearMarkers();
      }
      else {
        // Remove all individual items
        for(var i = 0; i < this.gmarkers.length; i++) {
          this.gmarkers[i].setMap(null);
        }
        this.gmarkers = [];
      }
    },

    addMarkers: function MapPlugin_addMarkers(gmarkers)
    {
      if(this.options.showCluster) {
        // Let the clusterer dedide what to show.
        this.markerCluster.addMarkers(gmarkers);
      }
      else {
        // Add as individual items on the map.
        this.gmarkers = this.gmarkers.concat(gmarkers);
        for(var i = 0; i < gmarkers.length; i++) {
          gmarkers[i].setMap(this.gmap);
        }
      }
    },

    onMapClick: function MapPlugin_onMapClick(event)
    {
      // event.latLng
      this.showStartPage();
    },

    onMapZoom: function MapPlugin_onMapZoom(event)
    {
      var gmap = this.gmap;
      this.$zoomBack[gmap.getZoom() > gmap.minZoom ? 'show' : 'hide']();
    },

    onZoomBackClick: function MapPlugin_onZoomBackClick(event)
    {
      event.preventDefault();
      event.target.blur();
      var gmap = this.gmap;

      this.showStartPage();
      gmap.setZoom(this.options.zoom || gmap.minZoom);
      gmap.panTo(this.options.defaultCenter);
    },

    onMarkerClick: function MapPlugin_onMarkerClick(event, marker)
    {
      if(event.stop)
        event.stop();  // no bubbling to the map.

      this.zoomTo(marker.getPosition(), marker._click_zoom || 7);
      this.loadMarkerDetails(marker, false);
    },

    loadMarkerDetails: function MapPlugin_fetchMarkerDetails(gmarker, move_map)
    {
      // URL is optional
      var url = this.options.markerDetailApiUrl;
      if(! url)
        return;

      var outer_this = this;
      $.ajax({
        url: url,
        data: {
          'map_id': this.options.mapId || 0,
          'id': gmarker._data.id
        },
        dataType: 'json'
      }).success(function(marker){
        outer_this.showMarkerDetails(marker);

        // Data is known afterwards, zoom to marker.
        if(move_map) {
          var icon = _getMarkerIcon(marker);
          var center = new google.maps.LatLng(marker.location[0], marker.location[1]);
          outer_this.zoomTo(center, marker.click_zoom || icon.marker_zoom);
        }
      });
    },

    _jsonToMarkers: function MapPlugin_jsonToMarkers(marker_data, icon)
    {
      var markers = [];
      for (var i = 0; i < marker_data.length; i++)
      {
        var marker = marker_data[i];
        var options = {
          position: new google.maps.LatLng(marker.location[0], marker.location[1]),
          icon: icon || _getMarkerIcon(marker),
          flat: true,

          // Markerwithlabel
          map: this.gmap,
          labelContent: marker.label || "",
          labelClass: "label", // the CSS class for the label
          labelAnchor: icon._labelAnchor,
          labelStyle: icon._labelStyle
        };
        if(!options.icon)
          delete options['icon'];
        var gmarker = new MarkerWithLabel(options);
        gmarker._data = marker;
        gmarker._click_zoom = marker.click_zoom || icon.marker_zoom;

        var outer_this = this;
        google.maps.event.addListener(gmarker, 'click', function(event){ outer_this.onMarkerClick(event, this); });
        markers.push(gmarker);
      }

      return markers;
    },

    zoomTo: function MapPlugin_zoomTo(latlng, minZoom)
    {
      if(this.gmap.getZoom() < minZoom)
        this.gmap.setZoom(minZoom);

      this.gmap.panTo(latlng);
    },

    /**
     * Show the opening page.
     */
    showStartPage: function MapPlugin_showStartPage()
    {
      // Switch panes
      $('.sidebar-pane').hide();
      $('.sidebar-pane.home').show();

      // Set location
      if(location.hash) {
        location.hash = '!';
      }
    },

    /**
     * Show the marker details in the sidebar
     */
    showMarkerDetails: function MapPlugin_showMarkerDetails(marker)
    {
      var $marker_detail = $('.marker-detail');

      // Switch panes
      $('.sidebar-pane').hide();
      $marker_detail.show();

      // Set location
      location.hash = '#!/marker/' + marker.id;

      // Fill values (already escaped server-side)
      $marker_detail.find('.marker-title').html(marker.title);
      $marker_detail.find('.marker-description').html(marker.description);
      $marker_detail.find('.marker-image').html(marker.image ? marker.image.html : '');
    }
  };


  function _createIcon(icon) {
    if(! icon)
      return null;

    var cx = Math.floor(icon.width / 2);
    var cy = Math.floor(icon.height / 2);

    icon.size = new google.maps.Size(icon.width, icon.height);
    icon.anchor = new google.maps.Point(cx, cy);
    icon._labelAnchor = new google.maps.Point(cx, cy);   // is relative to anchor
    icon._labelStyle = {
      width: icon.width + "px",
      lineHeight: icon.height + 'px',
      fontSize: icon.textSize + "px",
      color: icon.textColor
    };
    return icon;
  }


  function _getMarkerIcon(marker)
  {
    var clusterIndex = _getClusterStyleIndex(_getClusterValue(marker));
    return MARKER_ICONS[clusterIndex];
  }

  function _getClusterValue(marker) {
    return marker.clusterValue != null ? marker.clusterValue : 1;
  }

  function _getClusterStyle(markers, numStyles) {
    var clusterTotal = 0;
    for (var i = 0; i < markers.length; i++) {
      var marker = markers[i];
      clusterTotal += _getClusterValue(marker);
    }

    var index = _getClusterStyleIndex(clusterTotal) + 1;

    return {
      text: clusterTotal,
      index: index
    };
  }

  function _getClusterStyleIndex(icon_lights) {
    for (var i = 0; i < CLUSTER_STYLES.length; i++) {
      var style = CLUSTER_STYLES[i];
      if(style.min_lights > icon_lights) {
        return i - 1;  // previous candidate was ok!
      }
    }

    // Largest cluster
    return CLUSTER_STYLES.length - 1;
  }


  /**
   * jQuery Plugin definition
   */
  $.fn.mapPlugin = function(options) {
    this.each(function(){
      var map = $(this).data('mapPlugin');
      if(map == null) {
        map = new MapPlugin(this, options);
        $(this).data('mapPlugin', map);
      }
    });
    return this;
  };

  $.fn.ready(function(){
    $(".googlemaps-area.auto-enable").each(function() {
      var $this = $(this);
      $this.mapPlugin($this.data());
    });
  });

  // Use same jQuery as geoposition.js when loaded in the admin.
})(window.django ? window.django.jQuery : window.jQuery);
