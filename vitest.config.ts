import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/*/tests/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    // 引擎相关测试可能要加载 wasm，给足超时
    testTimeout: 60_000,
    hookTimeout: 60_000
  }
})
