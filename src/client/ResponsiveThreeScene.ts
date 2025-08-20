import * as THREE from 'three';
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls";
import { createNoise3D } from 'simplex-noise';

interface LandTile {
    id: number;
    name: string;
    type: 'ocean' | 'plains' | 'forest' | 'mountain' | 'desert' | 'city';
    color: THREE.Color; // Add this
    // ... other properties
}

export class ResponsiveThreeScene {
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private renderer: THREE.WebGLRenderer;
    private canvas: HTMLCanvasElement;
    private controls: OrbitControls;
    private noise3D = createNoise3D();

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.setupScene();
        this.setupEventListeners();
        this.animate();
    }

    private setupScene() {
        // Scene
        this.scene = new THREE.Scene();

        // Camera - IMPORTANT: Use window dimensions initially
        this.camera = new THREE.PerspectiveCamera(
            75, // Field of view
            window.innerWidth / window.innerHeight, // Aspect ratio
            0.1, // Near clipping
            1000 // Far clipping
        );

        // Renderer - IMPORTANT: Set initial size
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limit for performance

        this.controls = new OrbitControls(this.camera, this.canvas);
        this.controls.enableDamping = true; // Smooth movement
        this.controls.dampingFactor = 0.05;

        // Add some content (example cube)
        const geometry = new THREE.IcosahedronGeometry(4, 48);
        const colors = new Float32Array(geometry.attributes.position.count * 3); // RGB for each vertex

        // Get face count
        const faceCount = geometry.index ?
            geometry.index.count / 3 :
            geometry.attributes.position.count / 3;

        const triangleMap = new Map<number, LandTile>();

        // Iterate through faces and generate game data
        for (let i = 0; i < faceCount; i++) {
            const center = this.getTriangleCenter(geometry, i); // Get triangle position
            const type = this.getRandomLandType(center); // Pass position
            triangleMap.set(i, {
                id: i,
                name: 'test',
                type: type,
                color: this.getLandTypeColor(type)
            });
        }


        // Color each triangle's vertices
        for (let i = 0; i < faceCount; i++) {
            const tile = triangleMap.get(i);
            const color = tile.color;

            // Each face has 3 vertices, each needs RGB values
            for (let j = 0; j < 3; j++) {
                const vertexIndex = (i * 3 + j) * 3;
                colors[vertexIndex] = color.r;     // Red
                colors[vertexIndex + 1] = color.g; // Green  
                colors[vertexIndex + 2] = color.b; // Blue
            }
        }

        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        // const geometry = new THREE.BoxGeometry();
        const material = new THREE.MeshStandardMaterial({
            flatShading: true,
            vertexColors: true  // Remove the color property entirely
        });
        const cube = new THREE.Mesh(geometry, material);
        this.scene.add(cube);

        // Ambient light - provides overall illumination
        const ambientLight = new THREE.AmbientLight(0x404040, 5); // soft white light
        this.scene.add(ambientLight);

        // Directional light - creates shadows and definition  
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 5, 5);
        this.scene.add(directionalLight);

        this.camera.position.z = 5;
    }

    private getLandTypeColor(type: string): THREE.Color {
        switch (type) {
            case 'ocean':
                return new THREE.Color(0x0077be);
            case 'plains':
                return new THREE.Color(0x7cb342);
            case 'forest':
                return new THREE.Color(0x2e7d32);
            case 'mountain':
                return new THREE.Color(0x5d4037);
            case 'desert':
                return new THREE.Color(0xffc107);
            case 'city':
                return new THREE.Color(0x9e9e9e);
            default:
                return new THREE.Color(0x000000);
        }
    }

    private getTriangleCenter(geometry: THREE.BufferGeometry, faceIndex: number): THREE.Vector3 {
        const positions = geometry.attributes.position;

        if (geometry.index) {
            // Indexed geometry
            const i1 = geometry.index.getX(faceIndex * 3);
            const i2 = geometry.index.getX(faceIndex * 3 + 1);
            const i3 = geometry.index.getX(faceIndex * 3 + 2);

            const v1 = new THREE.Vector3().fromBufferAttribute(positions, i1);
            const v2 = new THREE.Vector3().fromBufferAttribute(positions, i2);
            const v3 = new THREE.Vector3().fromBufferAttribute(positions, i3);

            return v1.add(v2).add(v3).divideScalar(3);
        } else {
            // Non-indexed geometry - vertices are sequential
            const i1 = faceIndex * 3;
            const i2 = faceIndex * 3 + 1;
            const i3 = faceIndex * 3 + 2;

            const v1 = new THREE.Vector3().fromBufferAttribute(positions, i1);
            const v2 = new THREE.Vector3().fromBufferAttribute(positions, i2);
            const v3 = new THREE.Vector3().fromBufferAttribute(positions, i3);

            return v1.add(v2).add(v3).divideScalar(3);
        }
    }
    
    private get2DNoiseCoords(position: THREE.Vector3): { u: number, v: number } {
        const normalized = position.clone().normalize();
        const phi = Math.atan2(normalized.z, normalized.x);
        const theta = Math.acos(normalized.y);
        const u = (phi + Math.PI) / (2 * Math.PI);
        const v = theta / Math.PI;
        return {u, v};
    }

    private getNoise3D(position: THREE.Vector3, scale: number = 1): number {
        const noise = this.noise3D(
            position.x * scale,
            position.y * scale,
            position.z * scale
        );
        return (noise + 1) * 0.5; // Normalize from [-1,1] to [0,1]
    }

    private getLayeredNoise(position: THREE.Vector3): number {
        // Layer 1: Continental scale (big landmasses)
        const continental = this.getNoise3D(position, 0.5) * 0.6;

        // Layer 2: Regional scale (islands, regional features)  
        const regional = this.getNoise3D(position, 1.5) * 0.3;

        // Layer 3: Local scale (fine details)
        const local = this.getNoise3D(position, 4.0) * 0.1;

        return continental + regional + local;
    }

    private getRandomLandType(position: THREE.Vector3): LandTile['type'] {
        const elevation = this.getLayeredNoise(position);

        if (elevation < 0.4) return 'ocean';      // Adjusted threshold
        if (elevation > 0.75) return 'mountain';  // Adjusted threshold  
        if (elevation > 0.65) return 'desert';    // High, dry areas
        if (elevation > 0.45) return 'plains';    // Medium elevation
        return 'forest';                          // Low-medium elevation
    }
    
    private getBiomeFromClimate(elevation: number, temperature: number, moisture: number): LandTile['type'] {
        // Natural biome distribution
        if (elevation < 0.6) return 'ocean';           // Was 0.4, now 0.6 = much more ocean
        if (elevation > 0.8) return 'mountain';         // High peaks
        if (temperature > 0.7 && moisture < 0.1) return 'desert';    // Hot & dry
        if (moisture > 0.4) return 'forest';            // Wet areas
        return 'plains';                                // Everything else
    }

    private setupEventListeners() {
        // THIS IS THE KEY PART - Window resize handler
        window.addEventListener('resize', () => this.onWindowResize());
    }

    private onWindowResize() {
        // Update camera aspect ratio
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix(); // CRITICAL: Must call this after changing aspect

        // Update renderer size
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        // Update pixel ratio (for high-DPI displays)
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    }

    private animate = () => {
        requestAnimationFrame(this.animate);

        // Your game logic here
        this.controls.update(); // Add this line

        this.renderer.render(this.scene, this.camera);
    }

    // Clean up when done
    public dispose() {
        this.controls.dispose(); // Add this
        window.removeEventListener('resize', this.onWindowResize);
        this.renderer.dispose();
    }
}