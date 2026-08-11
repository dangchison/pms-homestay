import type { Metadata } from 'next';
import { Clause, LegalPage, Placeholder } from '@/components/Legal';
import { CONTACT } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Chính sách bảo mật',
  description:
    'Cách PMS Homestay thu thập, sử dụng và bảo vệ dữ liệu cá nhân, theo Nghị định 13/2023/NĐ-CP.',
  alternates: { canonical: '/bao-mat' },
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Chính sách bảo mật" updated="11/08/2026">
      <Clause heading="1. Ai xử lý dữ liệu">
        <p>
          <Placeholder>[tên pháp nhân]</Placeholder> vận hành dịch vụ PMS Homestay và là bên xử lý
          dữ liệu cá nhân theo hướng dẫn của cơ sở lưu trú sử dụng dịch vụ.
        </p>
        <p>
          Với dữ liệu khách lưu trú, <strong className="font-medium text-foreground">cơ sở lưu trú
          là bên kiểm soát dữ liệu</strong>: họ quyết định thu thập gì và vì sao. Chúng tôi lưu trữ
          và xử lý thay họ.
        </p>
      </Clause>

      <Clause heading="2. Dữ liệu chúng tôi xử lý">
        <ul>
          <li>
            <strong className="font-medium text-foreground">Của người dùng hệ thống:</strong> họ
            tên, email, số điện thoại, vai trò, nhật ký đăng nhập.
          </li>
          <li>
            <strong className="font-medium text-foreground">Của khách lưu trú (do cơ sở nhập):</strong>{' '}
            họ tên, ngày sinh, số định danh cá nhân hoặc hộ chiếu, địa chỉ thường trú, quốc tịch,
            thông tin lưu trú, thông tin thanh toán.
          </li>
          <li>
            <strong className="font-medium text-foreground">Dữ liệu vận hành:</strong> nhật ký hệ
            thống phục vụ xử lý sự cố và điều tra an ninh.
          </li>
        </ul>
        <p>
          Số định danh cá nhân là dữ liệu cá nhân cơ bản có tính nhạy cảm cao; hệ thống chỉ hiển
          thị dạng che một phần trên giao diện và ghi nhật ký mỗi lần xem bản đầy đủ.
        </p>
      </Clause>

      <Clause heading="3. Mục đích và cơ sở pháp lý">
        <ul>
          <li>Cung cấp dịch vụ quản lý lưu trú theo hợp đồng với cơ sở.</li>
          <li>
            Thực hiện nghĩa vụ luật định của cơ sở: khai báo lưu trú theo Thông tư 56, khai báo
            tạm trú cho người nước ngoài, lưu trữ chứng từ kế toán.
          </li>
          <li>Bảo đảm an ninh hệ thống và phát hiện gian lận.</li>
        </ul>
      </Clause>

      <Clause heading="4. Chia sẻ với bên thứ ba">
        <p>Chúng tôi không bán dữ liệu cá nhân. Dữ liệu chỉ được chuyển cho:</p>
        <ul>
          <li>Cơ quan nhà nước có thẩm quyền, khi luật yêu cầu.</li>
          <li>
            Nhà cung cấp hạ tầng và dịch vụ kỹ thuật phục vụ vận hành (lưu trữ, gửi thư, nhận diện
            giấy tờ, cổng thanh toán), theo hợp đồng có ràng buộc bảo mật.
          </li>
        </ul>
        <p>
          Danh sách bên xử lý dữ liệu hiện hành: <Placeholder>[liệt kê nhà cung cấp]</Placeholder>.
        </p>
      </Clause>

      <Clause heading="5. Lưu trữ và thời hạn">
        <ul>
          <li>Dữ liệu lưu tại <Placeholder>[khu vực máy chủ]</Placeholder>.</li>
          <li>
            Dữ liệu khách không phát sinh lưu trú trong 5 năm được ẩn danh tự động.
          </li>
          <li>
            Sau khi tài khoản đóng, dữ liệu được giữ thêm <Placeholder>[số ngày]</Placeholder> ngày
            để phòng khôi phục, rồi xoá.
          </li>
          <li>Chứng từ kế toán lưu theo thời hạn luật kế toán quy định.</li>
        </ul>
      </Clause>

      <Clause heading="6. Quyền của chủ thể dữ liệu">
        <p>
          Theo Nghị định 13/2023/NĐ-CP, bạn có quyền được biết, truy cập, chỉnh sửa, rút lại sự
          đồng ý, xoá, hạn chế và phản đối việc xử lý dữ liệu cá nhân của mình.
        </p>
        <p>
          Nếu bạn là khách lưu trú, hãy gửi yêu cầu tới cơ sở nơi bạn ở — họ là bên kiểm soát dữ
          liệu và hệ thống có sẵn chức năng để họ xuất hoặc xoá dữ liệu của bạn. Nếu không liên hệ
          được với cơ sở, viết thư cho chúng tôi và chúng tôi sẽ chuyển tiếp.
        </p>
      </Clause>

      <Clause heading="7. Bảo mật">
        <ul>
          <li>Dữ liệu mỗi cơ sở tách bạch ở tầng cơ sở dữ liệu, không chỉ ở tầng ứng dụng.</li>
          <li>Mật khẩu băm bằng Argon2id; dữ liệu nhạy cảm được mã hoá khi lưu.</li>
          <li>Truy cập của quản trị nền tảng dùng danh tính riêng và có ghi nhật ký.</li>
          <li>Kết nối mã hoá TLS.</li>
        </ul>
      </Clause>

      <Clause heading="8. Sự cố dữ liệu">
        <p>
          Khi xảy ra sự cố có nguy cơ ảnh hưởng tới dữ liệu cá nhân, chúng tôi thông báo cho cơ sở
          bị ảnh hưởng và cơ quan có thẩm quyền theo thời hạn luật định.
        </p>
      </Clause>

      <Clause heading="9. Liên hệ">
        {CONTACT.email ? (
          <p>
            Mọi câu hỏi về chính sách này: <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>.
          </p>
        ) : (
          <p>Địa chỉ liên hệ đang được cập nhật.</p>
        )}
        <p>
          Người phụ trách bảo vệ dữ liệu cá nhân: <Placeholder>[tên và liên hệ]</Placeholder>.
        </p>
      </Clause>
    </LegalPage>
  );
}
