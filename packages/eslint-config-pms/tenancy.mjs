/**
 * Quy tắc tenancy (docs/02 §withTenant, ADR-0002): trong apps/api/src/modules/**
 * cấm truy cập model qua `this.prisma.<model>` — mọi truy vấn bảng tenant-scoped
 * phải đi qua withTenant(tx => tx.<model>...). Cho phép API hệ thống dạng `$...`
 * (vd: this.prisma.$queryRaw cho health ping).
 */
export const tenancy = {
  files: ['src/modules/**/*.ts'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector:
          "MemberExpression[object.object.type='ThisExpression'][object.property.name='prisma'][property.name!=/^\\$/]",
        message:
          'Không dùng this.prisma.<model> trực tiếp trong modules/ — bọc trong withTenant(tx => tx.<model>...) để RLS context có hiệu lực (ADR-0002).',
      },
    ],
  },
};

export default tenancy;
