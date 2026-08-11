import type { Metadata } from 'next';
import { Clause, LegalPage, Placeholder } from '@/components/Legal';
import { CONTACT } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Điều khoản sử dụng',
  description: 'Điều khoản sử dụng dịch vụ PMS Homestay.',
  alternates: { canonical: '/dieu-khoan' },
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <LegalPage title="Điều khoản sử dụng" updated="11/08/2026">
      <Clause heading="1. Bên cung cấp dịch vụ">
        <p>
          Dịch vụ PMS Homestay do <Placeholder>[tên pháp nhân]</Placeholder>, mã số doanh nghiệp{' '}
          <Placeholder>[mã số thuế]</Placeholder>, địa chỉ{' '}
          <Placeholder>[địa chỉ trụ sở]</Placeholder> cung cấp.
        </p>
        <p>
          Khi tạo tài khoản và sử dụng dịch vụ, bạn đồng ý với các điều khoản dưới đây.
        </p>
      </Clause>

      <Clause heading="2. Tài khoản">
        <ul>
          <li>Mỗi tài khoản gắn với một đơn vị kinh doanh lưu trú và do bạn tự quản lý.</li>
          <li>
            Bạn chịu trách nhiệm giữ mật khẩu, phân quyền cho nhân viên, và mọi hoạt động phát
            sinh dưới tài khoản của mình.
          </li>
          <li>
            Chúng tôi có thể tạm ngưng tài khoản khi phát hiện hành vi gây hại tới hệ thống hoặc
            tới người dùng khác, và sẽ thông báo lý do.
          </li>
        </ul>
      </Clause>

      <Clause heading="3. Gói dịch vụ và thanh toán">
        <ul>
          <li>
            Tài khoản mới được dùng thử đầy đủ 14 ngày ở mức gói Khởi nghiệp. Hết thời gian dùng
            thử, tài khoản chuyển về gói miễn phí; dữ liệu đã có được giữ nguyên và chỉ bị chặn
            tạo thêm khi vượt hạn mức.
          </li>
          <li>Phí tính theo tháng, thanh toán bằng chuyển khoản. Giá công bố đã bao gồm thuế nếu có.</li>
          <li>
            Không thanh toán khi tới kỳ, tài khoản chuyển sang trạng thái tạm ngưng: vẫn đọc được
            dữ liệu nhưng không ghi thêm. Sau 60 ngày tạm ngưng liên tục, tài khoản chuyển sang
            trạng thái đóng.
          </li>
          <li>
            Chúng tôi có thể điều chỉnh giá và sẽ báo trước ít nhất{' '}
            <Placeholder>[số ngày]</Placeholder> ngày.
          </li>
        </ul>
      </Clause>

      <Clause heading="4. Dữ liệu của bạn">
        <ul>
          <li>Dữ liệu bạn nhập vào hệ thống là của bạn. Chúng tôi lưu trữ và xử lý để cung cấp dịch vụ.</li>
          <li>Bạn xuất được dữ liệu của mình bất cứ lúc nào trong thời gian tài khoản còn hoạt động.</li>
          <li>
            Với dữ liệu cá nhân của khách lưu trú, bạn là bên kiểm soát dữ liệu và chịu trách
            nhiệm về cơ sở pháp lý khi thu thập; chúng tôi là bên xử lý theo yêu cầu của bạn. Chi
            tiết ở <a href="/bao-mat">Chính sách bảo mật</a>.
          </li>
        </ul>
      </Clause>

      <Clause heading="5. Trách nhiệm khi dùng dịch vụ">
        <ul>
          <li>Bạn chịu trách nhiệm về tính chính xác của dữ liệu nhập vào và về nghĩa vụ pháp lý của cơ sở mình.</li>
          <li>
            Các chức năng hỗ trợ tuân thủ (tờ khai lưu trú, khai báo tạm trú người nước ngoài,
            hoá đơn) là công cụ hỗ trợ. Việc nộp đúng hạn và đúng nội dung cho cơ quan nhà nước
            vẫn thuộc trách nhiệm của bạn.
          </li>
          <li>
            Không dùng dịch vụ để lưu trữ hay phát tán nội dung vi phạm pháp luật Việt Nam.
          </li>
        </ul>
      </Clause>

      <Clause heading="6. Mức độ sẵn sàng và giới hạn trách nhiệm">
        <p>
          Chúng tôi nỗ lực duy trì dịch vụ hoạt động liên tục nhưng không cam kết không bao giờ
          gián đoạn. Bảo trì có kế hoạch sẽ được báo trước.
        </p>
        <p>
          Trong phạm vi pháp luật cho phép, trách nhiệm bồi thường của chúng tôi trong mọi trường
          hợp không vượt quá số phí bạn đã trả trong <Placeholder>[số tháng]</Placeholder> tháng
          liền trước thời điểm phát sinh sự việc.
        </p>
      </Clause>

      <Clause heading="7. Chấm dứt">
        <p>
          Bạn có thể ngừng sử dụng bất cứ lúc nào. Trước khi đóng tài khoản, hãy xuất dữ liệu cần
          giữ. Sau khi tài khoản đóng, dữ liệu được lưu thêm{' '}
          <Placeholder>[số ngày]</Placeholder> ngày rồi xoá.
        </p>
      </Clause>

      <Clause heading="8. Luật áp dụng và liên hệ">
        <p>
          Các điều khoản này chịu sự điều chỉnh của pháp luật Việt Nam. Tranh chấp được ưu tiên
          giải quyết bằng thương lượng.
        </p>
        {CONTACT.email && (
          <p>
            Liên hệ: <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>
          </p>
        )}
      </Clause>
    </LegalPage>
  );
}
