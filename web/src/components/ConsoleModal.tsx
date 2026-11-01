import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { api, getApiBase, getToken } from '../lib/api';
import { useAuth } from '../lib/auth';
import { errorMessage } from '../lib/use-api';
import type { ConsoleSession, GuestRecord } from '../lib/types';
import { Modal } from './common';

/** 根据当前页面地址拼接控制台 WebSocket 地址，兼容反向代理与 HTTPS 部署。 */
function consoleUrl(sessionId: string): string {
  const token = getToken() ?? '';
  const base = getApiBase();
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (/^http/i.test(base)) {
    const url = new URL(`${base}/console/${sessionId}`);
    url.protocol = protocol;
    url.searchParams.set('token', token);
    return url.toString();
  }
  return `${protocol}//${window.location.host}${base}/console/${sessionId}?token=${encodeURIComponent(token)}`;
}

/**
 * 控制台弹窗：
 * - LXC 串口（term）与演示集群使用 xterm.js 渲染服务端转发的字节流；
 * - 真实 PVE 的 QEMU VNC 会话已由服务端签发，浏览器需要 VNC 客户端才能绘制帧缓冲，
 *   这里明确提示，并保持 WebSocket 接口开放以便二次开发接入自研查看器。
 */
export function ConsoleModal({
  guest,
  open,
  onClose,
}: {
  guest: GuestRecord;
  open: boolean;
  onClose: () => void;
}) {
  const { bootstrap } = useAuth();
  const [status, setStatus] = useState<'connecting' | 'ready' | 'notice' | 'error'>('connecting');
  const [message, setMessage] = useState('');
  const terminalHostRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!open) {
      cleanupRef.current();
      cleanupRef.current = () => undefined;
      return;
    }
    let disposed = false;
    let socket: WebSocket | null = null;
    let terminal: Terminal | null = null;
    let observer: ResizeObserver | null = null;

    setStatus('connecting');
    setMessage('正在申请一次性控制台会话…');

    const setup = async (): Promise<void> => {
      const session = await api.post<ConsoleSession>(`/guests/${guest.id}/console`);
      if (disposed) return;

      if (session.kind === 'vnc' && !bootstrap?.demoMode) {
        setStatus('notice');
        setMessage(
          'QEMU 的 VNC 会话已签发，但浏览器端未内置 VNC 帧缓冲解码器。' +
            '可在二次开发中通过 /api/v1/console/{sessionId} WebSocket 接入任意开源 VNC 查看器。',
        );
        return;
      }

      const host = terminalHostRef.current;
      if (!host) return;
      host.innerHTML = '';
      terminal = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
        theme: {
          background: '#080e1c',
          foreground: '#dbe6f7',
          cursor: '#35d6c1',
          selectionBackground: '#243455',
        },
        convertEol: true,
        scrollback: 3000,
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(host);
      fit.fit();
      observer = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {
          // 容器隐藏时尺寸为 0，忽略
        }
      });
      observer.observe(host);

      socket = new WebSocket(consoleUrl(session.sessionId));
      socket.onopen = () => {
        setStatus('ready');
        setMessage('');
        terminal?.focus();
      };
      socket.onmessage = (event) => {
        const data = event.data;
        if (typeof data === 'string') terminal?.write(data);
        else if (data instanceof Blob) {
          void data.text().then((text) => terminal?.write(text));
        }
      };
      socket.onerror = () => {
        setStatus('error');
        setMessage('控制台连接失败，请确认后端服务与集群网络可达。');
      };
      socket.onclose = (event) => {
        if (event.code !== 1000 && event.code !== 1005) {
          setStatus('error');
          setMessage(`控制台连接已关闭（${event.code}${event.reason ? ` · ${event.reason}` : ''}）`);
        }
      };
      terminal.onData((data) => {
        if (socket && socket.readyState === WebSocket.OPEN) socket.send(data);
      });

      cleanupRef.current = () => {
        observer?.disconnect();
        try {
          socket?.close();
        } catch {
          // 忽略
        }
        terminal?.dispose();
      };
    };

    setup().catch((error: unknown) => {
      if (disposed) return;
      setStatus('error');
      setMessage(errorMessage(error, '控制台会话创建失败'));
    });

    return () => {
      disposed = true;
      cleanupRef.current();
      cleanupRef.current = () => undefined;
    };
  }, [open, guest.id, bootstrap?.demoMode]);

  return (
    <Modal
      open={open}
      title={`控制台 · ${guest.name}`}
      subtitle={`VMID ${guest.vmid} · ${guest.node} · ${guest.type.toUpperCase()}`}
      onClose={onClose}
      size="lg"
      footer={
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          关闭会话
        </button>
      }
    >
      {status === 'connecting' ? <div className="console-status">{message}</div> : null}
      {status === 'error' ? <div className="console-status error">{message}</div> : null}
      {status === 'notice' ? <div className="console-status notice">{message}</div> : null}
      <div className="console-shell" ref={terminalHostRef} />
    </Modal>
  );
}
