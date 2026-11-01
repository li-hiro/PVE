import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { errorMessage } from './use-api';

describe('errorMessage', () => {
  it('renders quota dimension details in a readable form', () => {
    const error = new ApiError(409, 'QUOTA_EXCEEDED', '配额不足', {
      dimensions: [{ label: 'CPU', limit: 8, requested: 2 }],
    });
    expect(errorMessage(error)).toBe('配额不足：CPU（上限 8，本次请求 2）');
  });

  it('falls back to the API error message', () => {
    expect(errorMessage(new ApiError(403, 'FORBIDDEN', '没有权限'))).toBe('没有权限');
  });

  it('handles plain errors and unknown values', () => {
    expect(errorMessage(new Error('网络错误'))).toBe('网络错误');
    expect(errorMessage('boom', '登录失败')).toBe('登录失败');
  });
});
