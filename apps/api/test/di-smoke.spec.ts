import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

@Injectable()
class DepService {
  hello(): string {
    return 'world';
  }
}

@Injectable()
class RootService {
  constructor(readonly dep: DepService) {}
}

/**
 * Gate tuần 1 (docs/01 §test): vitest mặc định dùng esbuild — KHÔNG hỗ trợ
 * emitDecoratorMetadata → DI theo type của NestJS hỏng âm thầm. Test này
 * chứng minh unplugin-swc đã transform đúng: constructor injection KHÔNG cần
 * @Inject() thủ công.
 */
describe('DI smoke — decorator metadata qua SWC', () => {
  it('NestJS resolve dependency từ type của constructor param', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [DepService, RootService],
    }).compile();

    const root = moduleRef.get(RootService);
    expect(root.dep).toBeInstanceOf(DepService);
    expect(root.dep.hello()).toBe('world');
  });
});
