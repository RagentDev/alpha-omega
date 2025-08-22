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
    private sphereMesh: THREE.Mesh; // Store reference to the sphere mesh
    private raycaster: THREE.Raycaster;
    private mouse: THREE.Vector2;

    // Subdivision control
    private SUBDIVIDES = 8; // Change this from 1-10 for different subdivision levels

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.setupScene();
        this.setupEventListeners();
        this.setupClickHandler();
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
        let geometry = new THREE.IcosahedronGeometry(4, 4);
        console.log(`Initial vertex count: ${geometry.attributes.position.count}`);

        // Add barycentric coordinates and triangle IDs as custom attributes
        // This will unindex the geometry and return it
        geometry = this.addBarycentricCoordinates(geometry);
        console.log(`Vertex count after unindexing: ${geometry.attributes.position.count}`);

        // Get face count
        const faceCount = geometry.index ?
            geometry.index.count / 3 :
            geometry.attributes.position.count / 3;

        // Calculate total number of sub-triangles
        // For n subdivisions, we get n^2 sub-triangles per face
        const subTrianglesPerFace = this.SUBDIVIDES * this.SUBDIVIDES;
        const totalTiles = faceCount * subTrianglesPerFace;

        console.log(`Face count: ${faceCount}`);
        console.log(`Sub-triangles per face: ${subTrianglesPerFace}`);
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
                
                // Hash function for generating random values from tileId
                vec3 hash3(float n) {
                    return fract(sin(vec3(n, n + 1.0, n + 2.0)) * vec3(43758.5453, 22578.1459, 19642.3490));
                }
                
                // Generate random color based on tileId
                vec3 getRandomColor(float tileId) {
                    vec3 randomValues = hash3(tileId);
                    
                    // HSV-based random colors for more pleasing results
                    float hue = randomValues.x;
                    float saturation = 0.5 + randomValues.y * 0.4; // 0.5 to 0.9
                    float value = 0.6 + randomValues.z * 0.3; // 0.6 to 0.9
                    
                    // Convert HSV to RGB
                    vec3 c = vec3(hue, saturation, value);
                    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
                    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
                    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
                }
                
                // Function to determine which sub-triangle index we're in
                float getSubTriangleIndex(vec3 bary) {
                    if (subdivisions <= 1.0) {
                        return 0.0;
                    }
                    
                    float n = subdivisions;
                    
                    // Convert barycentric to 2D coordinates
                    // We'll use the standard transformation where:
                    // x-axis goes from vertex 1 to vertex 2
                    // y-axis goes perpendicular
                    float u = bary.y; // Distance along edge from v1 to v2
                    float v = bary.z; // Distance along edge from v1 to v3
                    
                    // Scale to subdivision grid
                    float gridU = u * n;
                    float gridV = v * n;
                    
                    // Get grid coordinates
                    float gridX = floor(gridU);
                    float gridY = floor(gridV);
                    
                    // Local coordinates within grid cell
                    float localU = fract(gridU);
                    float localV = fract(gridV);
                    
                    // Make sure we're within the triangle bounds
                    if (gridX + gridY >= n) {
                        // We're outside the main triangle, clamp to edge
                        return subTrianglesPerFace - 1.0;
                    }
                    
                    // Calculate row and position within row
                    float row = gridY;
                    float col = gridX;
                    
                    // In each row y, there are 2*(n-y)-1 triangles
                    // Calculate triangles before this row
                    float trianglesBeforeRow = row * (2.0 * n - row);
                    
                    // In this grid cell, determine if we're in upper or lower triangle
                    float triangleInCell = (localU + localV > 1.0) ? 1.0 : 0.0;
                    
                    // Position in current row
                    float posInRow = col * 2.0 + triangleInCell;
                    
                    // Total index
                    float index = trianglesBeforeRow + posInRow;
                    
                    return clamp(index, 0.0, subTrianglesPerFace - 1.0);
                }
                
                // Function to draw edge lines for triangular subdivisions
                float getEdgeFactor(vec3 bary) {
                    if (subdivisions <= 1.0) {
                        return 1.0;
                    }
                    
                    float n = subdivisions;
                    
                    // Convert to grid coordinates
                    float u = bary.y * n;
                    float v = bary.z * n;
                    
                    // Get local position within grid cell
                    float localU = fract(u);
                    float localV = fract(v);
                    
                    // Distance to nearest edge
                    float edgeWidth = 0.03;
                    float minDist = min(localU, localV);
                    
                    // Check diagonal edge (for triangular subdivision)
                    float diagDist = abs(1.0 - localU - localV);
                    minDist = min(minDist, diagDist);
                    
                    // Also check proximity to main triangle edges
                    minDist = min(minDist, min(bary.x, min(bary.y, bary.z)) * n);
                    
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
                    
                    // Sample the specific sub-triangle color (or use random)
                    vec4 tileColor = texture2D(colorTexture, texCoord);
                    
                    // Generate random color based on tileId instead of sampling texture
                    // vec4 tileColor = vec4(getRandomColor(tileId), 1.0);
                    
                    // Apply edge darkening with improved edge detection
                    float edge = getEdgeFactor(vBarycentric);
                    vec3 edgeColor = vec3(0.2, 0.2, 0.2); // Dark edges
                    vec3 finalTileColor = mix(edgeColor, tileColor.rgb, edge);
                    
                    // Add some variation to each tile
                    float random = fract(sin(tileId * 12.9898) * 43758.5453);
                    float darkeningFactor = 0.9 + (random * 0.1);
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
        this.sphereMesh = sphere; // Store reference for raycasting
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
    private addBarycentricCoordinates(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
        // First, we need to unindex the geometry if it's indexed
        // This ensures each triangle has its own unique vertices
        if (geometry.index) {
            geometry = geometry.toNonIndexed();
        }

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

        return geometry; // Return the modified geometry
    }

    // Get position of a specific sub-triangle for noise sampling
    private getSubTrianglePosition(geometry: THREE.BufferGeometry, faceIndex: number, subIndex: number): THREE.Vector3 {
        const positions = geometry.attributes.position;

        // Get the three vertices of the main triangle
        const i1 = faceIndex * 3;
        const i2 = faceIndex * 3 + 1;
        const i3 = faceIndex * 3 + 2;

        const v1 = new THREE.Vector3().fromBufferAttribute(positions, i1);
        const v2 = new THREE.Vector3().fromBufferAttribute(positions, i2);
        const v3 = new THREE.Vector3().fromBufferAttribute(positions, i3);

        // For n subdivisions, we have n^2 sub-triangles
        // Calculate which sub-triangle this is
        const n = this.SUBDIVIDES;
        const subTrianglesPerRow = new Array(n);

        // Each row i has 2*(n-i)-1 triangles
        for (let i = 0; i < n; i++) {
            subTrianglesPerRow[i] = 2 * (n - i) - 1;
        }

        // Find which row this sub-triangle is in
        let row = 0;
        let trianglesBefore = 0;
        for (let i = 0; i < n; i++) {
            if (trianglesBefore + subTrianglesPerRow[i] > subIndex) {
                row = i;
                break;
            }
            trianglesBefore += subTrianglesPerRow[i];
        }

        const posInRow = subIndex - trianglesBefore;
        const col = Math.floor(posInRow / 2);
        const isUpper = (posInRow % 2) === 1;

        // Calculate barycentric coordinates for the center of this sub-triangle
        const step = 1.0 / n;
        let u, v, w;

        if (isUpper) {
            u = (row + 0.66) * step;
            v = (col + 0.66) * step;
        } else {
            u = (row + 0.33) * step;
            v = (col + 0.33) * step;
        }
        w = 1 - u - v;

        // Ensure valid barycentric coordinates
        if (w < 0) {
            const total = u + v;
            u = u / total;
            v = v / total;
            w = 0;
        }

        return new THREE.Vector3()
            .addScaledVector(v1, w)
            .addScaledVector(v2, u)
            .addScaledVector(v3, v);
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
        console.log(`Texture Size: ${textureSize}x${textureSize} for ${tileCount} tiles`);
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
                colorData[baseIndex + 0] = 1.0;
                colorData[baseIndex + 1] = 0.0;
                colorData[baseIndex + 2] = 1.0; // Magenta for missing tiles
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
        const i1 = faceIndex * 3;
        const i2 = faceIndex * 3 + 1;
        const i3 = faceIndex * 3 + 2;

        const v1 = new THREE.Vector3().fromBufferAttribute(positions, i1);
        const v2 = new THREE.Vector3().fromBufferAttribute(positions, i2);
        const v3 = new THREE.Vector3().fromBufferAttribute(positions, i3);

        return v1.add(v2).add(v3).divideScalar(3);
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
        if (elevation > 0.7 && elevation < 0.8) return 'forest';
        if (elevation > 0.8) return 'mountain';
        return 'forest';
    }

    private setupEventListeners() {
        window.addEventListener('resize', () => this.onWindowResize());
    }

    private setupClickHandler() {
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        this.canvas.addEventListener('click', (event) => {
            // Calculate mouse position in normalized device coordinates
            const rect = this.canvas.getBoundingClientRect();
            this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            // Update raycaster
            this.raycaster.setFromCamera(this.mouse, this.camera);

            // Check for intersections
            const intersects = this.raycaster.intersectObject(this.sphereMesh);

            if (intersects.length > 0) {
                const intersection = intersects[0];

                // Get the face that was clicked
                const faceIndex = intersection.face ?
                    Math.floor(intersection.faceIndex / 1) : 0;

                // Get barycentric coordinates of the click point
                const bary = this.getBarycentricCoordinates(
                    intersection.point,
                    intersection.face,
                    this.sphereMesh.geometry as THREE.BufferGeometry,
                    intersection.faceIndex
                );

                // Calculate which sub-triangle was clicked
                const subIndex = this.calculateSubTriangleIndex(bary);

                // Calculate the tile ID
                const tileId = faceIndex * (this.SUBDIVIDES * this.SUBDIVIDES) + subIndex;

                // Update the color to red
                this.updateSubTriangleColor(tileId, new THREE.Color(0xff0000));

                console.log(`Clicked tile ${tileId} (face ${faceIndex}, sub ${subIndex})`);
            }
        });
    }

    // Calculate barycentric coordinates for a point on a triangle
    private getBarycentricCoordinates(
        point: THREE.Vector3,
        face: THREE.Face | null,
        geometry: THREE.BufferGeometry,
        faceIndex: number
    ): THREE.Vector3 {
        const positions = geometry.attributes.position;

        // Get the three vertices of the triangle
        const i1 = faceIndex * 3;
        const i2 = faceIndex * 3 + 1;
        const i3 = faceIndex * 3 + 2;

        const v1 = new THREE.Vector3().fromBufferAttribute(positions, i1);
        const v2 = new THREE.Vector3().fromBufferAttribute(positions, i2);
        const v3 = new THREE.Vector3().fromBufferAttribute(positions, i3);

        // Transform point to local space of the mesh
        const localPoint = this.sphereMesh.worldToLocal(point.clone());

        // Calculate barycentric coordinates
        const v0 = v3.clone().sub(v1);
        const v1v2 = v2.clone().sub(v1);
        const v2p = localPoint.clone().sub(v1);

        const dot00 = v0.dot(v0);
        const dot01 = v0.dot(v1v2);
        const dot02 = v0.dot(v2p);
        const dot11 = v1v2.dot(v1v2);
        const dot12 = v1v2.dot(v2p);

        const invDenom = 1 / (dot00 * dot11 - dot01 * dot01);
        const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
        const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
        const w = 1 - u - v;

        return new THREE.Vector3(w, v, u);
    }

    // Calculate which sub-triangle index based on barycentric coordinates
    private calculateSubTriangleIndex(bary: THREE.Vector3): number {
        if (this.SUBDIVIDES <= 1) {
            return 0;
        }

        const n = this.SUBDIVIDES;

        // Convert barycentric to 2D grid coordinates
        const u = bary.y; // Distance along edge from v1 to v2
        const v = bary.z; // Distance along edge from v1 to v3

        // Scale to subdivision grid
        const gridU = u * n;
        const gridV = v * n;

        // Get grid coordinates
        const gridX = Math.floor(gridU);
        const gridY = Math.floor(gridV);

        // Local coordinates within grid cell
        const localU = gridU - gridX;
        const localV = gridV - gridY;

        // Make sure we're within the triangle bounds
        if (gridX + gridY >= n) {
            return (this.SUBDIVIDES * this.SUBDIVIDES) - 1;
        }

        // Calculate row and position within row
        const row = gridY;
        const col = gridX;

        // Calculate triangles before this row
        let trianglesBeforeRow = row * (2 * n - row);

        // In this grid cell, determine if we're in upper or lower triangle
        const triangleInCell = (localU + localV > 1.0) ? 1 : 0;

        // Position in current row
        const posInRow = col * 2 + triangleInCell;

        // Total index
        const index = trianglesBeforeRow + posInRow;

        return Math.min(Math.max(0, Math.floor(index)), (this.SUBDIVIDES * this.SUBDIVIDES) - 1);
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