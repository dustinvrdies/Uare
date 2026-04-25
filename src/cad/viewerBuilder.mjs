/**
 * Viewer Configuration and Options Builder
 * Generates viewer state, camera settings, and interactive configurations
 */

export function buildViewerOptions(assemblyDocument = {}, manifest = {}) {
  const parts = Array.isArray(assemblyDocument.parts) ? assemblyDocument.parts : [];
  
  // Calculate appropriate camera distance and target
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  
  for (const part of parts) {
    const dims = part.dimensions_mm || part.dims || { x: 0, y: 0, z: 0 };
    const pos = part.position || [0, 0, 0];
    const [px, py, pz] = [Number(pos[0]) || 0, Number(pos[1]) || 0, Number(pos[2]) || 0];
    const [dx, dy, dz] = [Number(dims.x) || 0, Number(dims.y) || 0, Number(dims.z) || 0];
    
    minX = Math.min(minX, px - dx / 2);
    minY = Math.min(minY, py - dy / 2);
    minZ = Math.min(minZ, pz - dz / 2);
    maxX = Math.max(maxX, px + dx / 2);
    maxY = Math.max(maxY, py + dy / 2);
    maxZ = Math.max(maxZ, pz + dz / 2);
  }
  
  if (!isFinite(minX)) {
    minX = minY = minZ = 0;
    maxX = maxY = maxZ = 100;
  }
  
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const rangeX = maxX - minX || 100;
  const rangeY = maxY - minY || 100;
  const rangeZ = maxZ - minZ || 100;
  const maxRange = Math.max(rangeX, rangeY, rangeZ);
  const cameraDistance = maxRange * 1.8;
  
  return {
    generated_at: new Date().toISOString(),
    viewport: {
      width_px: 1200,
      height_px: 800,
      fov_degrees: 45,
      near_m: 0.01,
      far_m: 5000,
      background_color: '#f0f0f0',
      antialiasing: true,
      shadows_enabled: true,
    },
    camera: {
      initial_position: [centerX + cameraDistance, centerY + cameraDistance * 0.5, centerZ + cameraDistance],
      target: [centerX, centerY, centerZ],
      up_vector: [0, 0, 1],
      zoom_speed: 1.2,
      orbit_speed: 1.0,
    },
    lighting: {
      ambient_intensity: 0.6,
      ambient_color: '#ffffff',
      directional_lights: [
        {
          name: 'main_light',
          position: [1, 1, 1],
          intensity: 0.9,
          color: '#ffffff',
          cast_shadow: true,
        },
        {
          name: 'fill_light',
          position: [-1, -0.5, 0.5],
          intensity: 0.4,
          color: '#e8e8ff',
          cast_shadow: false,
        },
      ],
      point_lights: [],
    },
    materials: {
      default: {
        color: '#cccccc',
        roughness: 0.5,
        metallic: 0.3,
        wireframe_mode: false,
      },
      selected: {
        color: '#ffaa00',
        roughness: 0.3,
        metallic: 0.8,
        emissive_intensity: 0.2,
      },
      highlighted: {
        color: '#00ff00',
        roughness: 0.4,
        metallic: 0.5,
        emissive_intensity: 0.1,
      },
    },
    interactions: {
      mouse_controls_enabled: true,
      orbit_rotate: true,
      pan_enabled: true,
      zoom_enabled: true,
      part_selection_enabled: true,
      part_info_on_hover: true,
      keyboard_shortcuts_enabled: true,
      touch_gestures_enabled: true,
    },
    display_modes: [
      {
        name: 'solid',
        description: 'Solid shading with lighting',
        wireframe: false,
        transparency: 1.0,
      },
      {
        name: 'wireframe',
        description: 'Wireframe mode',
        wireframe: true,
        transparency: 0.5,
      },
      {
        name: 'transparent',
        description: 'Semi-transparent with internal visibility',
        wireframe: false,
        transparency: 0.6,
      },
      {
        name: 'cross_section',
        description: 'Cross-section view',
        wireframe: false,
        transparency: 0.8,
      },
    ],
    animations: {
      explode_animation_enabled: true,
      explode_factor_default: 5,
      assembly_animation_enabled: true,
      assembly_animation_duration_ms: 3000,
      rotation_animation_enabled: true,
    },
    ui_panels: {
      part_list: { enabled: true, position: 'left', width_px: 300 },
      properties: { enabled: true, position: 'right', width_px: 250 },
      measurements: { enabled: true, position: 'bottom', height_px: 150 },
      notes: { enabled: true, position: 'floating', width_px: 400 },
    },
    export_formats: ['png', 'jpg', 'webp', 'svg'],
    measurement_tools: {
      distance: true,
      angle: true,
      diameter: true,
      radius: true,
    },
    keyboard_shortcuts: {
      'v': 'toggle_part_list',
      'h': 'toggle_help',
      'r': 'reset_view',
      'f': 'fit_all_in_view',
      'e': 'toggle_exploded_view',
      'a': 'play_assembly_animation',
      '1': 'show_top_view',
      '2': 'show_front_view',
      '3': 'show_right_view',
      '0': 'show_isometric_view',
    },
  };
}

export default { buildViewerOptions };
