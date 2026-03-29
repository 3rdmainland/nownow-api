import type { WebSocket } from 'ws';
import type { WebSocketMessage } from './websocket.types';

/**
 * BroadcastAdapter interface — abstracts how messages are sent to groups of clients.
 * Default: LocalBroadcastAdapter (in-memory Maps, single instance).
 * Future: RedisBroadcastAdapter (Redis pub/sub for horizontal scaling).
 */
export interface BroadcastAdapter {
    /** Add a socket to a named channel (e.g., "event:abc-123") */
    subscribe(channel: string, socket: WebSocket): void;
    /** Remove a socket from a named channel */
    unsubscribe(channel: string, socket: WebSocket): void;
    /** Remove a socket from ALL channels */
    unsubscribeAll(socket: WebSocket): void;
    /** Send a message to all sockets in a channel */
    publish(channel: string, message: string): void;
    /** Send a message to ALL connected sockets */
    publishAll(message: string): void;
    /** Get the set of sockets in a channel (for local sends) */
    getSubscribers(channel: string): Set<WebSocket> | undefined;
}

/**
 * In-memory broadcast adapter using Maps.
 * Suitable for single-instance deployments.
 */
export class LocalBroadcastAdapter implements BroadcastAdapter {
    private channels = new Map<string, Set<WebSocket>>();
    // Reverse index: socket → set of channels (for fast unsubscribeAll)
    private socketChannels = new Map<WebSocket, Set<string>>();

    subscribe(channel: string, socket: WebSocket): void {
        let set = this.channels.get(channel);
        if (!set) {
            set = new Set();
            this.channels.set(channel, set);
        }
        set.add(socket);

        let chans = this.socketChannels.get(socket);
        if (!chans) {
            chans = new Set();
            this.socketChannels.set(socket, chans);
        }
        chans.add(channel);
    }

    unsubscribe(channel: string, socket: WebSocket): void {
        const set = this.channels.get(channel);
        if (set) {
            set.delete(socket);
            if (set.size === 0) this.channels.delete(channel);
        }
        const chans = this.socketChannels.get(socket);
        if (chans) {
            chans.delete(channel);
            if (chans.size === 0) this.socketChannels.delete(socket);
        }
    }

    unsubscribeAll(socket: WebSocket): void {
        const chans = this.socketChannels.get(socket);
        if (chans) {
            for (const channel of chans) {
                const set = this.channels.get(channel);
                if (set) {
                    set.delete(socket);
                    if (set.size === 0) this.channels.delete(channel);
                }
            }
            this.socketChannels.delete(socket);
        }
    }

    publish(channel: string, message: string): void {
        const sockets = this.channels.get(channel);
        if (!sockets) return;
        for (const socket of sockets) {
            if (socket.readyState === socket.OPEN) {
                socket.send(message);
            }
        }
    }

    publishAll(message: string): void {
        // Deduplicate — a socket may be in multiple channels
        const seen = new Set<WebSocket>();
        for (const [, sockets] of this.channels) {
            for (const socket of sockets) {
                if (!seen.has(socket) && socket.readyState === socket.OPEN) {
                    seen.add(socket);
                    socket.send(message);
                }
            }
        }
    }

    getSubscribers(channel: string): Set<WebSocket> | undefined {
        return this.channels.get(channel);
    }
}

/** Singleton adapter — swap implementation here for horizontal scaling */
export const adapter: BroadcastAdapter = new LocalBroadcastAdapter();

// Channel key helpers
export const channels = {
    event: (id: string) => `event:${id}`,
    vendor: (id: string) => `vendor:${id}`,
    organizer: (id: string) => `organizer:${id}`,
    phone: (phone: string) => `phone:${phone}`,
    admin: () => 'admin',
} as const;
