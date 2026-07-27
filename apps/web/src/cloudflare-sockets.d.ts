declare module "cloudflare:sockets" {
  import type {
    CloudflareTcpConnect,
    CloudflareTcpSocket,
  } from "./server/cloudflare-tcp-fetch";

  export const connect: CloudflareTcpConnect;
  export type Socket = CloudflareTcpSocket;
}
