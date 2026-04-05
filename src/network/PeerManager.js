/**
 * PeerManager 3D - Mesh Networking for Spatial Data
 */
export class PeerManager {
    constructor(game) {
        this.game = game;
        this.persistentId = this.getOrCreateIdentity();
        this.peer = new Peer(this.persistentId); 
        this.connections = new Map(); 
        this.knownPeers = new Set(); 

        this.setupPeer();
        this.setupGossip();
        this.loadPersistentContacts();
    }

    getOrCreateIdentity() {
        let id = localStorage.getItem('sojourner_my_id');
        if (!id) {
            // Generate a stable UUID-like ID for this browser
            id = 'sojourner-' + Math.random().toString(36).substring(2, 11) + '-' + Date.now().toString(36);
            localStorage.setItem('sojourner_my_id', id);
        }
        return id;
    }

    loadPersistentContacts() {
        try {
            const saved = localStorage.getItem('sojourner_contacts');
            if (saved) {
                const contacts = JSON.parse(saved);
                contacts.forEach(id => this.knownPeers.add(id));
                console.log('Loaded persistent contacts:', contacts.length);
            }
        } catch (e) { console.warn('Could not load contacts'); }
    }

    savePersistentContacts() {
        try {
            const contacts = Array.from(this.knownPeers);
            localStorage.setItem('sojourner_contacts', JSON.stringify(contacts));
        } catch (e) { console.warn('Could not save contacts'); }
    }

    setupGossip() {
        // Periodically share known peers to expand the mesh
        setInterval(() => {
            if (this.connections.size > 0) {
                this.broadcast('GOSSIP', { 
                    peers: Array.from(this.knownPeers) 
                });
            }
        }, 10000); // Every 10 seconds
    }

    setupPeer() {
        this.peer.on('open', (id) => {
            console.log('3D Peer Initialized:', id);
            const peerDisplay = document.getElementById('peer-id');
            if (peerDisplay) peerDisplay.innerText = id.substring(0, 6);
            this.handleIncomingJoin();
            this.bootstrapMesh();
        });

        this.peer.on('connection', (conn) => {
            this.setupConnection(conn);
        });

        this.peer.on('error', (err) => {
            console.error('Peer 3D error:', err);
        });
    }

    bootstrapMesh() {
        // Attempt to reconnect to all known historical peers (Staggered to prevent storm)
        if (this.knownPeers.size > 0) {
            const peers = Array.from(this.knownPeers);
            let index = 0;
            const interval = setInterval(() => {
                const id = peers[index++];
                if (!id || index > peers.length) {
                    clearInterval(interval);
                    return;
                }
                if (id !== this.peer.id && !this.connections.has(id)) {
                    this.connectToPeer(id);
                }
            }, 200); // 1 peer every 200ms
        }
    }

    handleIncomingJoin() {
        const urlParams = new URLSearchParams(window.location.search);
        const joinId = urlParams.get('join');
        if (joinId && joinId !== this.peer.id) {
            this.game.log(`Requesting entry from mesh peer ${joinId.substring(0,4)}...`);
            this.connectToPeer(joinId);
        }
    }

    connectToPeer(id) {
        if (this.connections.has(id)) return;
        const conn = this.peer.connect(id);
        this.setupConnection(conn);
    }

    setupConnection(conn) {
        conn.on('open', () => {
            this.connections.set(conn.peer, conn);
            if (!this.knownPeers.has(conn.peer)) {
                this.knownPeers.add(conn.peer);
                this.savePersistentContacts();
            }
            this.game.log(`Synchronizing contact book...`);

            // Handshake: Send our position and known mesh peers
            this.send(conn, 'MESH_SYNC', {
                pos: { 
                    x: this.game.camera.position.x, 
                    y: this.game.camera.position.y, 
                    z: this.game.camera.position.z,
                    ry: this.game.camera.rotation.y
                },
                peers: Array.from(this.knownPeers) // Transmitting the contact book
            });
        });

        conn.on('data', (data) => {
            this.handleData(conn, data);
        });

        conn.on('close', () => {
            this.connections.delete(conn.peer);
            this.game.removeRemotePlayer(conn.peer);
        });
    }

    handleData(conn, data) {
        const { type, payload } = data;

        switch (type) {
            case 'MESH_SYNC':
                // Initial contact exchange
                payload.peers.forEach(pId => {
                    if (pId !== this.peer.id) this.connectToPeer(pId);
                });
                this.game.updateRemotePlayers(conn.peer, payload.pos);
                break;
            
            case 'GOSSIP':
                // Continuous background synchronization (Contact Book expansion)
                payload.peers.forEach(pId => {
                    if (pId !== this.peer.id && !this.knownPeers.has(pId)) {
                        this.game.log(`Discovered mesh peer ${pId.substring(0,4)}...`);
                        this.connectToPeer(pId);
                        this.knownPeers.add(pId);
                        this.savePersistentContacts();
                    }
                });
                break;
            
            case 'MOVE':
                this.game.updateRemotePlayers(conn.peer, payload);
                break;
        }
    }

    broadcast(type, payload) {
        this.connections.forEach(conn => {
            this.send(conn, type, payload);
        });
    }

    send(conn, type, payload) {
        if (conn && conn.open) {
            conn.send({ type, payload });
        }
    }

    getInviteLink() {
        const url = window.location.origin + window.location.pathname;
        return `${url}?join=${this.peer.id}`;
    }
}
