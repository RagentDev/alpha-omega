import {io} from "socket.io-client";
import * as THREE from 'three';
import {ResponsiveThreeScene} from "./ResponsiveThreeScene";

// TODO: REECE TESTING THREE STUFF
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);

const threeScene = new ResponsiveThreeScene(canvas);

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    threeScene.dispose();
});


// Connect to your server running on port 3000
const socket = io("http://localhost:3000");

// Add connection event listeners for logging
socket.on("connect", () => {
    console.log("✅ Connected to server!");
    console.log("Socket ID:", socket.id);
});

socket.on("disconnect", (reason) => {
    console.log("❌ Disconnected from server. Reason:", reason);
});

socket.on("connect_error", (error) => {
    console.error("🚫 Connection error:", error);
});

// Test sending a message to the server
socket.emit("hello", "Hello from client!");

// Listen for messages from the server
socket.on("message", (data) => {
    console.log("📨 Message from server:", data);
});