import { describe, expect, it, vi } from 'vitest';
import { type Env } from '@core/config/env.schema';
import { AppException } from '@core/http/exceptions/app.exception';
import { type MailService } from '@core/mail/mail.service';
import { LogMessagingProvider } from './log-messaging.provider';
import { MockMessagingProvider } from './mock-messaging.provider';
import { NotificationProviderRegistry } from './notification-provider.registry';
import { SmtpEmailProvider } from './smtp-email.provider';

const MOCK_ID_RE = /^mock-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function makeRegistry(env: Partial<Env>): {
  registry: NotificationProviderRegistry;
  mock: MockMessagingProvider;
  log: LogMessagingProvider;
  smtp: SmtpEmailProvider;
} {
  const mock = new MockMessagingProvider();
  const log = new LogMessagingProvider();
  const smtp = new SmtpEmailProvider({ send: vi.fn().mockResolvedValue(true) } as unknown as MailService);
  const registry = new NotificationProviderRegistry(env as Env, mock, log, smtp);
  return { registry, mock, log, smtp };
}

describe('MockMessagingProvider', () => {
  it('send() trả SENT + providerMessageId dạng mock-<uuid>', async () => {
    const res = await new MockMessagingProvider().send({
      channel: 'SMS',
      recipient: '+84900000000',
      title: 't',
      body: 'b',
    });
    expect(res.status).toBe('SENT');
    expect(res.providerMessageId).toMatch(MOCK_ID_RE);
  });

  it('name = mock', () => {
    expect(new MockMessagingProvider().name).toBe('mock');
  });
});

describe('LogMessagingProvider (backward-compatible stub)', () => {
  it('send() trả SENT + providerMessageId=null và KHÔNG throw (không I/O ngoài)', async () => {
    const res = await new LogMessagingProvider().send({
      channel: 'ZNS',
      recipient: 'user-id',
      title: 't',
      body: 'b',
    });
    expect(res.status).toBe('SENT');
    expect(res.providerMessageId).toBeNull();
  });

  it('name = log', () => {
    expect(new LogMessagingProvider().name).toBe('log');
  });
});

describe('SmtpEmailProvider', () => {
  it('send() gọi MailService.send({to,subject,text,html}) đúng 1 lần → SENT khi true', async () => {
    const send = vi.fn().mockResolvedValue(true);
    const provider = new SmtpEmailProvider({ send } as unknown as MailService);
    const res = await provider.send({
      channel: 'EMAIL',
      recipient: 'a@b.test',
      title: 'Tiêu đề',
      body: 'Nội dung',
      html: '<p>x</p>',
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ to: 'a@b.test', subject: 'Tiêu đề', text: 'Nội dung', html: '<p>x</p>' });
    expect(res.status).toBe('SENT');
    expect(provider.name).toBe('smtp');
  });

  it('map false → FAILED', async () => {
    const provider = new SmtpEmailProvider({ send: vi.fn().mockResolvedValue(false) } as unknown as MailService);
    const res = await provider.send({ channel: 'EMAIL', recipient: 'a@b.test', title: 't', body: 'b' });
    expect(res.status).toBe('FAILED');
  });
});

describe('NotificationProviderRegistry.forChannel() DI theo env', () => {
  it("SMS_PROVIDER='mock' → forChannel('SMS') = MockMessagingProvider", () => {
    const { registry, mock } = makeRegistry({ SMS_PROVIDER: 'mock', ZNS_PROVIDER: 'mock' });
    expect(registry.forChannel('SMS')).toBe(mock);
  });

  it("SMS_PROVIDER='log' → forChannel('SMS') = LogMessagingProvider", () => {
    const { registry, log } = makeRegistry({ SMS_PROVIDER: 'log', ZNS_PROVIDER: 'mock' });
    expect(registry.forChannel('SMS')).toBe(log);
  });

  it("ZNS_PROVIDER='mock' → forChannel('ZNS') = MockMessagingProvider", () => {
    const { registry, mock } = makeRegistry({ SMS_PROVIDER: 'log', ZNS_PROVIDER: 'mock' });
    expect(registry.forChannel('ZNS')).toBe(mock);
  });

  it("ZNS_PROVIDER='log' → forChannel('ZNS') = LogMessagingProvider", () => {
    const { registry, log } = makeRegistry({ SMS_PROVIDER: 'mock', ZNS_PROVIDER: 'log' });
    expect(registry.forChannel('ZNS')).toBe(log);
  });

  it("forChannel('EMAIL') luôn = SmtpEmailProvider bất kể env", () => {
    const { registry, smtp } = makeRegistry({ SMS_PROVIDER: 'log', ZNS_PROVIDER: 'log' });
    expect(registry.forChannel('EMAIL')).toBe(smtp);
  });

  it("esms/zalo (chưa impl) → ném AppException 'provider chưa cấu hình'", () => {
    const { registry } = makeRegistry({ SMS_PROVIDER: 'esms', ZNS_PROVIDER: 'zalo' });
    for (const channel of ['SMS', 'ZNS'] as const) {
      try {
        registry.forChannel(channel);
        expect.unreachable('phải ném vì provider chưa cấu hình');
      } catch (err) {
        expect(err).toBeInstanceOf(AppException);
        expect((err as AppException).code).toBe('NOTIFICATION_PROVIDER_NOT_CONFIGURED');
        expect((err as AppException).getStatus()).toBe(503);
      }
    }
  });
});
