import * as THREE from 'three';

export class ResponsiveThreeScene {
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private renderer: THREE.WebGLRenderer;
    private canvas: HTMLCanvasElement;

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

        // Add some content (example cube)
        const geometry = new THREE.BoxGeometry();
        const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
        const cube = new THREE.Mesh(geometry, material);
        this.scene.add(cube);

        this.camera.position.z = 5;
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

        this.renderer.render(this.scene, this.camera);
    }

    // Clean up when done
    public dispose() {
        window.removeEventListener('resize', this.onWindowResize);
        this.renderer.dispose();
    }
}