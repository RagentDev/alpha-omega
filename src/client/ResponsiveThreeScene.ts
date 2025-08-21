import * as THREE from 'three';
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls";
import { createNoise3D } from 'simplex-noise';

interface LandTile {
    id: number;
    name: string;
    type: 'ocean' | 'plains' | 'forest' | 'mountain' | 'desert' | 'city';
    color: THREE.Color;
    parentTriangle: number; // Which main triangle this belongs to
    subIndex: number; // Which sub-triangle within the parent
    // ... other properties
}

export class ResponsiveThreeScene {
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private renderer: THREE.WebGLRenderer;
    private canvas: HTMLCanvasElement;
    private controls: OrbitControls;
    private noise3D = createNoise3D();

    // Texture-based coloring properties
    private triangleMap = new Map<number, LandTile>();
    private colorDataTexture: THREE.DataTexture;
    private sphereMaterial: THREE.ShaderMaterial;

    // Subdivision control
    private SUBDIVIDES = 4; // Change this from 1-10 for different subdivision levels

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.setupScene();
        this.setupEventListeners();
        this.animate();
    }

    private setupScene() {
        // Scene
        this.scene = new THREE.Scene();

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );

        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        this.controls = new OrbitControls(this.camera, this.canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        // Create geometry with LOWER detail
        const geometry = new THREE.IcosahedronGeometry(4, 32);
        console.log(`Vertex count: ${geometry.attributes.position.count}`);

        // Add barycentric coordinates and triangle IDs as custom attributes
        this.addBarycentricCoordinates(geometry);

        // Get face count
        const faceCount = geometry.index ?
            geometry.index.count / 3 :
            geometry.attributes.position.count / 3;

        // Calculate total number of sub-triangles
        const subTrianglesPerFace = (this.SUBDIVIDES * (this.SUBDIVIDES + 1)) / 2;
        const totalTiles = faceCount * subTrianglesPerFace;

        console.log(`Total Tiles: ${totalTiles}`);

        // Generate game data for ALL sub-triangles
        let tileId = 0;
        for (let faceIdx = 0; faceIdx < faceCount; faceIdx++) {
            const faceCenter = this.getTriangleCenter(geometry, faceIdx);

            // Generate data for each sub-triangle within this face
            for (let subIdx = 0; subIdx < subTrianglesPerFace; subIdx++) {
                // Calculate sub-triangle position for noise sampling
                const subPos = this.getSubTrianglePosition(geometry, faceIdx, subIdx);
                const type = this.getRandomLandType(subPos);

                this.triangleMap.set(tileId, {
                    id: tileId,
                    name: `face_${faceIdx}_sub_${subIdx}`,
                    type: type,
                    color: this.getLandTypeColor(type),
                    parentTriangle: faceIdx,
                    subIndex: subIdx
                });

                tileId++;
            }
        }

        // Create texture from ALL sub-triangle data
        this.createColorDataTexture(totalTiles);

        // Create custom shader material with subdivision
        this.sphereMaterial = new THREE.ShaderMaterial({
            uniforms: {
                colorTexture: { value: this.colorDataTexture },
                textureSize: { value: Math.ceil(Math.sqrt(totalTiles)) },
                totalTriangles: { value: faceCount },
                subdivisions: { value: this.SUBDIVIDES },
                subTrianglesPerFace: { value: subTrianglesPerFace },
                // Lighting uniforms
                ambientLight: { value: new THREE.Color(0x404040).multiplyScalar(5) },
                directionalLightColor: { value: new THREE.Color(0xffffff).multiplyScalar(0.8) },
                directionalLightDirection: { value: new THREE.Vector3(5, 5, 5).normalize() }
            },
            vertexShader: `
                attribute vec3 barycentric;
                attribute float triangleId;
                
                varying vec3 vNormal;
                varying vec3 vPosition;
                varying float vTriangleId;
                varying vec3 vBarycentric;
                
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
                    vBarycentric = barycentric;
                    
                    // Use the triangle ID attribute for consistent identification
                    vTriangleId = triangleId;
                    
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D colorTexture;
                uniform float textureSize;
                uniform float totalTriangles;
                uniform float subdivisions;
                uniform float subTrianglesPerFace;
                uniform vec3 ambientLight;
                uniform vec3 directionalLightColor;
                uniform vec3 directionalLightDirection;
                
                varying vec3 vNormal;
                varying vec3 vPosition;
                varying float vTriangleId;
                varying vec3 vBarycentric;
                
                // Function to determine which sub-triangle index we're in
                float getSubTriangleIndex(vec3 bary) {
                    if (subdivisions <= 1.0) {
                        return 0.0;
                    }
                    
                    // Clamp barycentric coordinates to prevent edge cases
                    vec3 clampedBary = clamp(bary, 0.001, 0.999);
                    
                    // Scale barycentric coordinates by subdivision level
                    vec3 scaledBary = clampedBary * subdivisions;
                    
                    // Get integer parts (which sub-triangle cell we're in)
                    float u = floor(scaledBary.x);
                    float v = floor(scaledBary.y);
                    float w = floor(scaledBary.z);
                    
                    // Ensure we stay within the triangular bounds
                    u = clamp(u, 0.0, subdivisions - 1.0);
                    v = clamp(v, 0.0, subdivisions - 1.0);
                    
                    // For triangular subdivision, ensure u + v < subdivisions
                    if (u + v >= subdivisions) {
                        if (u > v) {
                            u = subdivisions - 1.0 - v;
                        } else {
                            v = subdivisions - 1.0 - u;
                        }
                    }
                    
                    // Calculate linear index using triangular number formula
                    // This maps 2D triangle coordinates to 1D array index
                    float index = u * subdivisions - (u * (u + 1.0)) / 2.0 + v;
                    
                    return clamp(index, 0.0, subTrianglesPerFace - 1.0);
                }
                
                // Function to draw edge lines
                float getEdgeFactor(vec3 bary) {
                    if (subdivisions <= 1.0) {
                        return 1.0;
                    }
                    
                    // Clamp barycentric coordinates
                    vec3 clampedBary = clamp(bary, 0.001, 0.999);
                    vec3 scaledBary = clampedBary * subdivisions;
                    vec3 fractPart = fract(scaledBary);
                    
                    // Calculate distance to nearest edge
                    float edgeWidth = 0.04 * subdivisions;
                    float minDist = min(min(fractPart.x, fractPart.y), fractPart.z);
                    minDist = min(minDist, min(1.0 - fractPart.x, min(1.0 - fractPart.y, 1.0 - fractPart.z)));
                    
                    return smoothstep(0.0, edgeWidth, minDist);
                }
                
                void main() {
                    // Use the triangle ID directly from vertex attribute
                    float triangleId = vTriangleId;
                    
                    // Determine which sub-triangle we're in
                    float subIndex = getSubTriangleIndex(vBarycentric);
                    
                    // Calculate the actual tile ID
                    float tileId = triangleId * subTrianglesPerFace + subIndex;
                    
                    // Convert tile ID to texture coordinates
                    float x = mod(tileId, textureSize);
                    float y = floor(tileId / textureSize);
                    vec2 texCoord = (vec2(x, y) + 0.5) / textureSize;
                    
                    // Sample the specific sub-triangle color
                    vec4 tileColor = texture2D(colorTexture, texCoord);
                    
                    // Apply edge darkening with improved edge detection
                    float edge = getEdgeFactor(vBarycentric);
                    vec3 edgeColor = tileColor.rgb * 0.8;
                    vec3 finalTileColor = mix(edgeColor, tileColor.rgb, edge);
                    
                    float random = fract(sin(tileId * 12.9898) * 43758.5453);
                    float darkeningFactor = 1.0 - (random * 0.2); // Scale from 0.8 to 1.0

                    finalTileColor *= darkeningFactor;
                    
                    // Lighting calculation
                    vec3 normal = normalize(vNormal);
                    float lightIntensity = max(dot(normal, directionalLightDirection), 0.0);
                    
                    vec3 lighting = ambientLight + directionalLightColor * lightIntensity;
                    vec3 finalColor = finalTileColor * lighting;
                    
                    gl_FragColor = vec4(finalColor, tileColor.a);
                }
            `,
            side: THREE.DoubleSide
        });

        const sphere = new THREE.Mesh(geometry, this.sphereMaterial);
        this.scene.add(sphere);

        // Lighting
        const ambientLight = new THREE.AmbientLight(0x404040, 5);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 5, 5);
        this.scene.add(directionalLight);

        this.camera.position.z = 5;
    }

    // Add barycentric coordinates and triangle IDs to geometry
    private addBarycentricCoordinates(geometry: THREE.BufferGeometry) {
        const posCount = geometry.attributes.position.count;
        const barycentrics = new Float32Array(posCount * 3);
        const triangleIds = new Float32Array(posCount); // Add triangle ID attribute

        for (let i = 0; i < posCount; i += 3) {
            const triangleId = Math.floor(i / 3);

            // Set triangle ID for all three vertices of this triangle
            triangleIds[i] = triangleId;
            triangleIds[i + 1] = triangleId;
            triangleIds[i + 2] = triangleId;

            // First vertex: (1, 0, 0)
            barycentrics[i * 3] = 1;
            barycentrics[i * 3 + 1] = 0;
            barycentrics[i * 3 + 2] = 0;

            // Second vertex: (0, 1, 0)
            barycentrics[(i + 1) * 3] = 0;
            barycentrics[(i + 1) * 3 + 1] = 1;
            barycentrics[(i + 1) * 3 + 2] = 0;

            // Third vertex: (0, 0, 1)
            barycentrics[(i + 2) * 3] = 0;
            barycentrics[(i + 2) * 3 + 1] = 0;
            barycentrics[(i + 2) * 3 + 2] = 1;
        }

        geometry.setAttribute('barycentric', new THREE.BufferAttribute(barycentrics, 3));
        geometry.setAttribute('triangleId', new THREE.BufferAttribute(triangleIds, 1)); // Add triangle ID attribute
    }

    // Get position of a specific sub-triangle for noise sampling
    private getSubTrianglePosition(geometry: THREE.BufferGeometry, faceIndex: number, subIndex: number): THREE.Vector3 {
        const positions = geometry.attributes.position;

        // Get the three vertices of the main triangle (your existing code)
        let v1, v2, v3;
        if (geometry.index) {
            const i1 = geometry.index.getX(faceIndex * 3);
            const i2 = geometry.index.getX(faceIndex * 3 + 1);
            const i3 = geometry.index.getX(faceIndex * 3 + 2);

            v1 = new THREE.Vector3().fromBufferAttribute(positions, i1);
            v2 = new THREE.Vector3().fromBufferAttribute(positions, i2);
            v3 = new THREE.Vector3().fromBufferAttribute(positions, i3);
        } else {
            const i1 = faceIndex * 3;
            const i2 = faceIndex * 3 + 1;
            const i3 = faceIndex * 3 + 2;

            v1 = new THREE.Vector3().fromBufferAttribute(positions, i1);
            v2 = new THREE.Vector3().fromBufferAttribute(positions, i2);
            v3 = new THREE.Vector3().fromBufferAttribute(positions, i3);
        }

        // **Fixed triangular coordinate calculation**
        let row = 0;
        let remainingIndex = subIndex;

        // Find which row by subtracting row lengths
        while (remainingIndex >= (this.SUBDIVIDES - row) && row < this.SUBDIVIDES) {
            remainingIndex -= (this.SUBDIVIDES - row);
            row++;
        }

        const col = remainingIndex;

        // **Safety check - ensure we don't go outside triangle bounds**
        if (row >= this.SUBDIVIDES || col >= (this.SUBDIVIDES - row)) {
            console.warn(`Invalid triangle coordinates: row=${row}, col=${col}, SUBDIVIDES=${this.SUBDIVIDES}`);
            // Return triangle center as fallback
            return v1.clone().add(v2).add(v3).divideScalar(3);
        }

        // Convert to barycentric coordinates
        const u = (row + 0.5) / this.SUBDIVIDES;
        const v = (col + 0.5) / this.SUBDIVIDES;
        const w = 1 - u - v;

        // **Additional safety check for barycentric coordinates**
        if (w < 0) {
            // Fallback to triangle center
            return v1.clone().add(v2).add(v3).divideScalar(3);
        }

        return new THREE.Vector3()
            .addScaledVector(v1, u)
            .addScaledVector(v2, v)
            .addScaledVector(v3, w);
    }

    // Method to update subdivision level dynamically
    public setSubdivisionLevel(level: number) {
        const newLevel = Math.max(1, Math.min(10, level));
        if (newLevel !== this.SUBDIVIDES) {
            this.SUBDIVIDES = newLevel;
            // Would need to regenerate all tile data and texture here
            console.warn('Changing subdivision level requires regenerating tile data. Implement regeneration logic here.');
        }
    }

    // Create data texture from triangle colors
    private createColorDataTexture(tileCount: number) {
        const textureSize = Math.ceil(Math.sqrt(tileCount));
        console.log(`Texture Size: ${textureSize} | ${textureSize * textureSize}`);
        const totalTexels = textureSize * textureSize;

        const colorData = new Float32Array(totalTexels * 4);

        // Fill with tile colors
        for (let i = 0; i < tileCount; i++) {
            const tile = this.triangleMap.get(i);
            const baseIndex = i * 4;

            if (tile) {
                colorData[baseIndex + 0] = tile.color.r;
                colorData[baseIndex + 1] = tile.color.g;
                colorData[baseIndex + 2] = tile.color.b;
                colorData[baseIndex + 3] = 1.0;
            } else {
                colorData[baseIndex + 0] = 0.0;
                colorData[baseIndex + 1] = 0.0;
                colorData[baseIndex + 2] = 0.0;
                colorData[baseIndex + 3] = 1.0;
            }
        }

        // Fill remaining texels
        for (let i = tileCount; i < totalTexels; i++) {
            const baseIndex = i * 4;
            colorData[baseIndex + 0] = 0.0;
            colorData[baseIndex + 1] = 0.0;
            colorData[baseIndex + 2] = 0.0;
            colorData[baseIndex + 3] = 1.0;
        }

        this.colorDataTexture = new THREE.DataTexture(
            colorData,
            textureSize,
            textureSize,
            THREE.RGBAFormat,
            THREE.FloatType
        );
        this.colorDataTexture.needsUpdate = true;
        this.colorDataTexture.magFilter = THREE.NearestFilter;
        this.colorDataTexture.minFilter = THREE.NearestFilter;
    }

    // Update a specific sub-triangle color
    public updateSubTriangleColor(tileId: number, color: THREE.Color) {
        const tile = this.triangleMap.get(tileId);
        if (tile) {
            tile.color = color;

            const textureSize = Math.ceil(Math.sqrt(this.triangleMap.size));
            const baseIndex = tileId * 4;

            if (this.colorDataTexture.image.data) {
                const data = this.colorDataTexture.image.data as Float32Array;
                data[baseIndex + 0] = color.r;
                data[baseIndex + 1] = color.g;
                data[baseIndex + 2] = color.b;
                data[baseIndex + 3] = 1.0;

                this.colorDataTexture.needsUpdate = true;
            }
        }
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
                return new THREE.Color(0x808080);
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
            const i1 = geometry.index.getX(faceIndex * 3);
            const i2 = geometry.index.getX(faceIndex * 3 + 1);
            const i3 = geometry.index.getX(faceIndex * 3 + 2);

            const v1 = new THREE.Vector3().fromBufferAttribute(positions, i1);
            const v2 = new THREE.Vector3().fromBufferAttribute(positions, i2);
            const v3 = new THREE.Vector3().fromBufferAttribute(positions, i3);

            return v1.add(v2).add(v3).divideScalar(3);
        } else {
            const i1 = faceIndex * 3;
            const i2 = faceIndex * 3 + 1;
            const i3 = faceIndex * 3 + 2;

            const v1 = new THREE.Vector3().fromBufferAttribute(positions, i1);
            const v2 = new THREE.Vector3().fromBufferAttribute(positions, i2);
            const v3 = new THREE.Vector3().fromBufferAttribute(positions, i3);

            return v1.add(v2).add(v3).divideScalar(3);
        }
    }

    private getNoise3D(position: THREE.Vector3, scale: number = 1): number {
        const noise = this.noise3D(
            position.x * scale,
            position.y * scale,
            position.z * scale
        );
        return (noise + 1) * 0.5;
    }

    private getLayeredNoise(position: THREE.Vector3): number {
        const continental = this.getNoise3D(position, 0.5) * 0.6;
        const regional = this.getNoise3D(position, 1.5) * 0.3;
        const local = this.getNoise3D(position, 4.0) * 0.1;
        return continental + regional + local;
    }

    private getRandomLandType(position: THREE.Vector3): LandTile['type'] {
        const elevation = this.getLayeredNoise(position);
        
        if (elevation < 0.45) return 'ocean';
        if (elevation > 0.45 && elevation < 0.5) return 'desert';
        if (elevation > 0.5 && elevation < 0.7) return 'plains';
        if (elevation > 0.5 && elevation < 0.7) return 'plains';
        if (elevation > 0.7 && elevation < 0.8) return 'forest';
        if (elevation > 0.8) return 'mountain';
        return 'forest';
    }

    private setupEventListeners() {
        window.addEventListener('resize', () => this.onWindowResize());
    }

    private onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    }

    private animate = () => {
        requestAnimationFrame(this.animate);
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    public dispose() {
        this.controls.dispose();
        window.removeEventListener('resize', this.onWindowResize);
        this.renderer.dispose();

        if (this.colorDataTexture) {
            this.colorDataTexture.dispose();
        }
        if (this.sphereMaterial) {
            this.sphereMaterial.dispose();
        }
    }
}