import { createContext, useContext, useEffect, useState } from "react";
import { io } from "socket.io-client";

const SocketContext = createContext({ socket: null, connected: false });

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let s = null;
    try {
      const isDev = import.meta.env.DEV;
      const socketUrl = isDev 
        ? window.location.origin.replace("5173", "5000") 
        : window.location.origin;

      s = io(socketUrl, {
        transports: ["polling", "websocket"],
        reconnectionAttempts: 3,
        timeout: 5000,
      });

      s.on("connect", () => {
        setConnected(true);
      });

      s.on("disconnect", () => {
        setConnected(false);
      });

      s.on("connect_error", (err) => {
        setConnected(false);
      });

      setSocket(s);
    } catch (err) {
      console.warn("Socket initialization error:", err);
    }

    return () => {
      if (s) {
        try {
          s.disconnect();
        } catch (e) {
          // ignore cleanup errors
        }
      }
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket, connected }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => useContext(SocketContext);
