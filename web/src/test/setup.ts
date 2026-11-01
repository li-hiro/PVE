import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// 前端组件会使用 ResizeObserver（ECharts / xterm 自适应），jsdom 未内置。
class ResizeObserverStub {
  observe(): void {
    // 测试环境不触发尺寸变化
  }
  unobserve(): void {
    // 测试环境不触发尺寸变化
  }
  disconnect(): void {
    // 测试环境不触发尺寸变化
  }
}

if (!('ResizeObserver' in globalThis)) {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: ResizeObserverStub,
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
