import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { PeerManager } from './network/PeerManager.js';

/**
 * Sojourner 3D - P2P Mesh Engine
 */
class Engine3D {
    constructor() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x050505);
        this.scene.fog = new THREE.FogExp2(0x050505, 0.02);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 1.7, 5); // Start at eye-level
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        document.getElementById('game-container').appendChild(this.renderer.domElement);

        this.controls = new PointerLockControls(this.camera, document.body);
        this.network = null;
        this.remotePlayers = new Map(); // id -> THREE.Object3D

        this.velocity = new THREE.Vector3();
        this.direction = new THREE.Vector3();
        this.moveState = { forward: false, backward: false, left: false, right: false };
        this.lastNetworkUpdate = 0;
        this.networkInterval = 50; // ms

        this.setupLights();
        this.setupWorld();
        this.setupEvents();
        
        this.animate();
    }

    setupLights() {
        const ambient = new THREE.AmbientLight(0x404040);
        this.scene.add(ambient);

        const sun = new THREE.DirectionalLight(0x00ffd2, 1);
        sun.position.set(100, 100, 50);
        this.scene.add(sun);
    }

    setupWorld() {
        // Glowing Neon Grid
        const gridHelper = new THREE.GridHelper(1000, 100, 0x00ffd2, 0x004433);
        gridHelper.position.y = -0.01;
        this.scene.add(gridHelper);

        // Procedural 'Cyber Monoliths'
        const geometry = new THREE.BoxGeometry(2, 20, 2);
        for (let i = 0; i < 400; i++) {
            const h = 5 + Math.random() * 20;
            const geo = new THREE.BoxGeometry(1.5, h, 1.5);
            const mat = new THREE.MeshPhongMaterial({ 
                color: 0x111111, 
                emissive: 0x001111,
                flatShading: true 
            });
            const mesh = new THREE.Mesh(geo, mat);
            
            // Deterministic scatter
            const angle = i * 0.1;
            const dist = 20 + i * 0.5;
            mesh.position.x = Math.cos(angle) * dist;
            mesh.position.z = Math.sin(angle) * dist;
            mesh.position.y = h / 2;
            this.scene.add(mesh);
        }

        // Add Stars
        const starGeo = new THREE.BufferGeometry();
        const starPos = [];
        for (let i = 0; i < 10000; i++) {
            starPos.push((Math.random() - 0.5) * 2000, (Math.random() - 0.5) * 2000, (Math.random() - 0.5) * 2000);
        }
        starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
        const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.7 });
        const stars = new THREE.Points(starGeo, starMat);
        this.scene.add(stars);
    }

    setupEvents() {
        const joinScreen = document.getElementById('join-screen');
        const hud = document.getElementById('game-hud');

        document.getElementById('enter-btn').onclick = () => {
            this.controls.lock();
            joinScreen.classList.add('hidden');
            hud.classList.remove('hidden');
            
            // Start Networking if not already
            if (!this.network) this.network = new PeerManager(this);
        };

        // Re-lock on click if already entered the world
        document.body.addEventListener('mousedown', () => {
            if (joinScreen.classList.contains('hidden') && !this.controls.isLocked) {
                this.controls.lock();
            }
        });

        document.getElementById('share-btn').onclick = (e) => {
            e.stopPropagation(); // Prevent re-locking when just clicking UI
            if (this.network) {
                const link = this.network.getInviteLink();
                navigator.clipboard.writeText(link);
                this.log('Invite link copied!', 'accent');
            }
        };

        const onKey = (e, pressed) => {
            switch(e.code) {
                case 'KeyW': this.moveState.forward = pressed; break;
                case 'KeyS': this.moveState.backward = pressed; break;
                case 'KeyA': this.moveState.left = pressed; break;
                case 'KeyD': this.moveState.right = pressed; break;
            }
        };

        window.addEventListener('keydown', (e) => onKey(e, true));
        window.addEventListener('keyup', (e) => onKey(e, false));
        window.addEventListener('resize', () => this.onWindowResize());
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    updateNetwork() {
        if (this.network) {
            this.network.broadcast('MOVE', {
                x: this.camera.position.x,
                y: this.camera.position.y,
                z: this.camera.position.z,
                ry: this.camera.rotation.y
            });
        }
    }

    updateRemotePlayers(id, data) {
        let playerRecord = this.remotePlayers.get(id);
        if (!playerRecord) {
            // Distinctive Avatar: Glowing Pyramid with Core
            const group = new THREE.Group();
            
            const geometry = new THREE.ConeGeometry(1.5, 4, 4);
            const material = new THREE.MeshPhongMaterial({ 
                color: 0x00d1ff, 
                emissive: 0x00ffff,
                emissiveIntensity: 0.5,
                transparent: true,
                opacity: 0.8
            });
            const mesh = new THREE.Mesh(geometry, material);
            group.add(mesh);

            const coreGeo = new THREE.SphereGeometry(0.4, 8, 8);
            const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
            const core = new THREE.Mesh(coreGeo, coreMat);
            core.position.y = 0.5;
            group.add(core);

            this.scene.add(group);
            
            playerRecord = {
                mesh: group,
                targetPos: new THREE.Vector3(data.x, data.y - 0.5, data.z),
                targetRot: data.ry
            };
            this.remotePlayers.set(id, playerRecord);
            this.log(`Peer detected in the grid.`, 'accent');
        }
        
        // Update Targets (Interpolation targets)
        playerRecord.targetPos.set(data.x, data.y - 0.5, data.z);
        playerRecord.targetRot = data.ry;
        
        document.getElementById('peer-count').innerText = this.remotePlayers.size;
    }

    removeRemotePlayer(id) {
        const record = this.remotePlayers.get(id);
        if (record) {
            this.scene.remove(record.mesh);
            this.remotePlayers.delete(id);
            this.log(`Peer departed.`, 'dimmed');
        }
        document.getElementById('peer-count').innerText = this.remotePlayers.size;
    }

    log(msg) {
        const container = document.getElementById('p2p-log');
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.innerText = msg;
        container.prepend(entry);
        if (container.children.length > 8) container.lastChild.remove();
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        if (this.controls.isLocked) {
            const time = performance.now();
            const delta = 0.1; // Simple fixed delta

            this.velocity.multiplyScalar(0.9); // Friction
            
            this.direction.z = Number(this.moveState.forward) - Number(this.moveState.backward);
            this.direction.x = Number(this.moveState.right) - Number(this.moveState.left);
            this.direction.normalize();

            if (this.moveState.forward || this.moveState.backward) this.velocity.z -= this.direction.z * 10.0 * delta;
            if (this.moveState.left || this.moveState.right) this.velocity.x -= this.direction.x * 10.0 * delta;

            this.controls.moveRight(-this.velocity.x * delta);
            this.controls.moveForward(-this.velocity.z * delta);
            
            // Throttled network update
            const now = performance.now();
            if (now - this.lastNetworkUpdate > this.networkInterval) {
                if (Math.abs(this.velocity.x) > 0.001 || Math.abs(this.velocity.z) > 0.001) {
                    this.updateNetwork();
                    this.lastNetworkUpdate = now;
                }
            }
        }

        // Interpolate Remote Players
        this.remotePlayers.forEach(p => {
            p.mesh.position.lerp(p.targetPos, 0.15); // Smooth Glide
            
            // Simple rotation lerp
            const rotDiff = p.targetRot - p.mesh.rotation.y;
            p.mesh.rotation.y += rotDiff * 0.15;
        });

        this.renderer.render(this.scene, this.camera);
    }
}

// Boot
window.onload = () => new Engine3D();
