import { Server } from "socket.io";

const io = new Server(3000, {
    cors: {
        origin: "http://localhost:5173", // Vite's default port
        methods: ["GET", "POST"]
    }
});

io.on("connection", (socket) => {
    console.log("✅ Client connected:", socket.id);

    // Send a welcome message
    socket.emit("message", "Welcome to Alpha Omega!");

    // Listen for hello messages
    socket.on("hello", (data) => {
        console.log("📨 Received from client:", data);
        socket.emit("message", "Hello back from server!");
    });

    socket.on("disconnect", (reason) => {
        console.log("❌ Client disconnected:", socket.id, "Reason:", reason);
    });
});

console.log("🚀 Server listening on port 3000");