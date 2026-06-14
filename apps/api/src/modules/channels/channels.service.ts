import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  type ChannelMappingResponse,
  type ChannelResponse,
  type ChannelType,
  type CreateChannelMappingRequest,
  type CreateChannelRequest,
  type JwtClaims,
  type SyncJobStatus,
  type UpdateChannelMappingRequest,
  type UpdateChannelRequest,
} from '@pms/shared-types';
import { type channel_resource_mappings, type channels, Prisma } from '@prisma/client';
import { PermissionService } from '@core/auth/permission.service';
import { EncryptionService } from '@core/crypto/encryption.service';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';

type ChannelWithProperty = channels;
type MappingWithChannel = channel_resource_mappings & { channels: { property_id: string } };

function newToken(): string {
  return randomBytes(24).toString('hex');
}

function toMappingResponse(m: channel_resource_mappings): ChannelMappingResponse {
  return {
    id: m.id,
    channel_id: m.channel_id,
    resource_id: m.resource_id,
    external_listing_id: m.external_listing_id,
    external_listing_url: m.external_listing_url,
    ical_pull_url: m.ical_pull_url,
    ical_push_token: m.ical_push_token,
    is_active: m.is_active,
    last_pulled_at: m.last_pulled_at ? m.last_pulled_at.toISOString() : null,
    last_event_count: m.last_event_count,
    created_at: m.created_at.toISOString(),
  };
}

/**
 * Channels + resource mappings (task 5.1, docs/03 §4.8). Property-scoped: pha-1
 * RBAC `channel.manage` (controller) + pha-2 authorizeOnProperty (đây, property_id
 * lấy TỪ channel). secret config (api_key) mã hoá AES-256-GCM qua EncryptionService
 * (ADR-0007) — lưu `api_key_enc`, response chỉ trả cờ `has_secret`. Worker pull/push
 * (5.2/5.3) đọc secret qua `getDecryptedConfig` (đường giải mã duy nhất).
 */
@Injectable()
export class ChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionService: PermissionService,
    private readonly encryption: EncryptionService,
  ) {}

  // ── config secret: encrypt khi ghi, mask khi đọc ────────────────────────────
  private encodeConfig(config: Record<string, unknown> | undefined): Prisma.InputJsonValue {
    const { api_key, api_key_enc: _drop, ...rest } = (config ?? {}) as Record<string, unknown>;
    const out: Record<string, unknown> = { ...rest };
    if (typeof api_key === 'string' && api_key.length > 0) {
      out.api_key_enc = this.encryption.encrypt(api_key);
    }
    return out as Prisma.InputJsonValue;
  }

  private maskConfig(stored: unknown): { config: Record<string, unknown>; has_secret: boolean } {
    const { api_key_enc, api_key: _api_key, ...rest } = (stored ?? {}) as Record<string, unknown>;
    return { config: rest, has_secret: typeof api_key_enc === 'string' && api_key_enc.length > 0 };
  }

  private toChannelResponse(c: ChannelWithProperty): ChannelResponse {
    const { config, has_secret } = this.maskConfig(c.config);
    return {
      id: c.id,
      property_id: c.property_id,
      channel_type: c.channel_type as ChannelType,
      display_name: c.display_name,
      config,
      has_secret,
      is_active: c.is_active,
      last_synced_at: c.last_synced_at ? c.last_synced_at.toISOString() : null,
      last_sync_status: c.last_sync_status as SyncJobStatus | null,
      created_at: c.created_at.toISOString(),
      updated_at: c.updated_at.toISOString(),
    };
  }

  // ── Channels CRUD ───────────────────────────────────────────────────────────
  async createChannel(dto: CreateChannelRequest, user: JwtClaims): Promise<ChannelResponse> {
    await this.assertPropertyExists(dto.property_id, user);
    await this.permissionService.authorizeOnProperty(user, dto.property_id, 'channel.manage');

    const row = await withTenant(this.prisma, user.tnt, (tx) =>
      tx.channels.create({
        data: {
          tenant_id: user.tnt,
          property_id: dto.property_id,
          channel_type: dto.channel_type,
          display_name: dto.display_name,
          config: this.encodeConfig(dto.config),
          is_active: dto.is_active ?? true,
        },
      }),
    );
    return this.toChannelResponse(row);
  }

  async listChannels(propertyId: string, user: JwtClaims): Promise<ChannelResponse[]> {
    await this.permissionService.authorizeOnProperty(user, propertyId, 'channel.manage');
    const rows = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.channels.findMany({ where: { property_id: propertyId }, orderBy: { created_at: 'desc' } }),
      { readOnly: true },
    );
    return rows.map((c) => this.toChannelResponse(c));
  }

  async getChannel(id: string, user: JwtClaims): Promise<ChannelResponse> {
    const channel = await this.loadChannelOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, channel.property_id, 'channel.manage');
    return this.toChannelResponse(channel);
  }

  async updateChannel(id: string, dto: UpdateChannelRequest, user: JwtClaims): Promise<ChannelResponse> {
    const channel = await this.loadChannelOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, channel.property_id, 'channel.manage');

    const row = await withTenant(this.prisma, user.tnt, (tx) =>
      tx.channels.update({
        where: { id },
        data: {
          ...(dto.display_name !== undefined ? { display_name: dto.display_name } : {}),
          ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
          // config gửi lên THAY THẾ toàn bộ (re-encode secret) — muốn giữ api_key phải gửi lại.
          ...(dto.config !== undefined ? { config: this.encodeConfig(dto.config) } : {}),
        },
      }),
    );
    return this.toChannelResponse(row);
  }

  async removeChannel(id: string, user: JwtClaims): Promise<void> {
    const channel = await this.loadChannelOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, channel.property_id, 'channel.manage');
    await withTenant(this.prisma, user.tnt, async (tx) => {
      // Xoá mapping con trước (FK không cascade) rồi xoá channel.
      await tx.channel_resource_mappings.deleteMany({ where: { channel_id: id } });
      await tx.channels.delete({ where: { id } });
    });
  }

  /** ★ Đường giải mã secret DUY NHẤT — chỉ worker sync (5.2/5.3) gọi. */
  async getDecryptedConfig(channelId: string, tenantId: string): Promise<Record<string, unknown>> {
    const channel = await withTenant(
      this.prisma,
      tenantId,
      (tx) => tx.channels.findFirst({ where: { id: channelId } }),
      { readOnly: true },
    );
    if (!channel) throw new AppException({ code: 'CHANNEL_NOT_FOUND', title: 'Kênh không tồn tại', status: 404 });
    const { api_key_enc, ...rest } = (channel.config ?? {}) as Record<string, unknown>;
    const out: Record<string, unknown> = { ...rest };
    if (typeof api_key_enc === 'string' && api_key_enc.length > 0) {
      out.api_key = this.encryption.decrypt(api_key_enc);
    }
    return out;
  }

  // ── Mappings CRUD ────────────────────────────────────────────────────────────
  async createMapping(
    channelId: string,
    dto: CreateChannelMappingRequest,
    user: JwtClaims,
  ): Promise<ChannelMappingResponse> {
    const channel = await this.loadChannelOrThrow(channelId, user);
    await this.permissionService.authorizeOnProperty(user, channel.property_id, 'channel.manage');
    await this.assertResourceInProperty(dto.resource_id, channel.property_id, user);

    const row = await withTenant(this.prisma, user.tnt, (tx) =>
      tx.channel_resource_mappings.create({
        data: {
          tenant_id: user.tnt,
          channel_id: channelId,
          resource_id: dto.resource_id,
          external_listing_id: dto.external_listing_id,
          external_listing_url: dto.external_listing_url ?? null,
          ical_pull_url: dto.ical_pull_url ?? null,
          is_active: dto.is_active ?? true,
        },
      }),
    ).catch((err: unknown) => {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppException({
          code: 'CHANNEL_MAPPING_DUPLICATE',
          title: 'Resource đã được map vào kênh này',
          status: 409,
        });
      }
      throw err;
    });
    return toMappingResponse(row);
  }

  async listMappings(channelId: string, user: JwtClaims): Promise<ChannelMappingResponse[]> {
    const channel = await this.loadChannelOrThrow(channelId, user);
    await this.permissionService.authorizeOnProperty(user, channel.property_id, 'channel.manage');
    const rows = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.channel_resource_mappings.findMany({ where: { channel_id: channelId }, orderBy: { created_at: 'desc' } }),
      { readOnly: true },
    );
    return rows.map(toMappingResponse);
  }

  async updateMapping(
    id: string,
    dto: UpdateChannelMappingRequest,
    user: JwtClaims,
  ): Promise<ChannelMappingResponse> {
    const mapping = await this.loadMappingOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, mapping.channels.property_id, 'channel.manage');

    const row = await withTenant(this.prisma, user.tnt, (tx) =>
      tx.channel_resource_mappings.update({
        where: { id },
        data: {
          ...(dto.external_listing_id !== undefined ? { external_listing_id: dto.external_listing_id } : {}),
          ...(dto.external_listing_url !== undefined ? { external_listing_url: dto.external_listing_url } : {}),
          ...(dto.ical_pull_url !== undefined ? { ical_pull_url: dto.ical_pull_url } : {}),
          ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
        },
      }),
    );
    return toMappingResponse(row);
  }

  async removeMapping(id: string, user: JwtClaims): Promise<void> {
    const mapping = await this.loadMappingOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, mapping.channels.property_id, 'channel.manage');
    await withTenant(this.prisma, user.tnt, (tx) =>
      tx.channel_resource_mappings.delete({ where: { id } }),
    );
  }

  /** Sinh lại ical_push_token (thu hồi token cũ — OTA cần cập nhật URL mới). */
  async regenerateToken(id: string, user: JwtClaims): Promise<ChannelMappingResponse> {
    const mapping = await this.loadMappingOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, mapping.channels.property_id, 'channel.manage');
    const row = await withTenant(this.prisma, user.tnt, (tx) =>
      tx.channel_resource_mappings.update({ where: { id }, data: { ical_push_token: newToken() } }),
    );
    return toMappingResponse(row);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  private async loadChannelOrThrow(id: string, user: JwtClaims): Promise<channels> {
    const channel = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.channels.findFirst({ where: { id } }),
      { readOnly: true },
    );
    if (!channel) throw new AppException({ code: 'CHANNEL_NOT_FOUND', title: 'Kênh không tồn tại', status: 404 });
    return channel;
  }

  private async loadMappingOrThrow(id: string, user: JwtClaims): Promise<MappingWithChannel> {
    const mapping = await withTenant(
      this.prisma,
      user.tnt,
      (tx) =>
        tx.channel_resource_mappings.findFirst({
          where: { id },
          include: { channels: { select: { property_id: true } } },
        }),
      { readOnly: true },
    );
    if (!mapping) {
      throw new AppException({ code: 'CHANNEL_MAPPING_NOT_FOUND', title: 'Mapping không tồn tại', status: 404 });
    }
    return mapping as MappingWithChannel;
  }

  private async assertPropertyExists(propertyId: string, user: JwtClaims): Promise<void> {
    const prop = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.properties.findFirst({ where: { id: propertyId }, select: { id: true } }),
      { readOnly: true },
    );
    if (!prop) throw new AppException({ code: 'PROPERTY_NOT_FOUND', title: 'Cơ sở không tồn tại', status: 404 });
  }

  /** Resource phải tồn tại + thuộc đúng property của channel (listing map theo resource). */
  private async assertResourceInProperty(
    resourceId: string,
    propertyId: string,
    user: JwtClaims,
  ): Promise<void> {
    const resource = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.bookable_resources.findFirst({ where: { id: resourceId }, select: { property_id: true } }),
      { readOnly: true },
    );
    if (!resource) {
      throw new AppException({ code: 'RESOURCE_NOT_FOUND', title: 'Resource không tồn tại', status: 404 });
    }
    if (resource.property_id !== propertyId) {
      throw new AppException({
        code: 'RESOURCE_PROPERTY_MISMATCH',
        title: 'Resource không thuộc cơ sở của kênh',
        status: 422,
      });
    }
  }
}
