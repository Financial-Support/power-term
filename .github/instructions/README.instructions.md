# ⚡ Dự án: [Tên dự án của bạn - VD: Electerm Pro]

Đây là dự án mở rộng dựa trên **electerm** - một client Terminal/SSH/SFTP mã nguồn mở, đa nền tảng.

---

## 1. 🎯 Tổng quan & Mục tiêu

* **Dựa trên Cơ sở:** **electerm** (Electron, React, TypeScript, Node.js).
* **Mục tiêu Cốt lõi:**
    > **[Mô tả ngắn gọn mục tiêu cuối cùng bạn muốn đạt được - VD: Thêm tính năng quản lý dịch vụ Cloud (AWS/Azure) trực tiếp trong giao diện terminal, hoặc Tối ưu hóa hiệu suất SFTP cho các file dung lượng lớn.]**
* **Đối tượng Người dùng:** **[Ai sẽ sử dụng sản phẩm này? - VD: Kỹ sư DevOps, Lập trình viên Backend, Quản trị viên hệ thống.]**

---

## 2. 💻 Công nghệ Cốt lõi (Core Tech Stack)

Dự án này sử dụng kiến trúc **Electron** với mô hình **Main Process (Backend)** và **Render Process (Frontend)**. 

* **Ngôn ngữ Lập trình:** **TypeScript**, JavaScript (ES6+).
* **Frontend (Render Process):**
    * **Framework:** **React** (sử dụng Hooks/Context API/[Redux/Zustand...]).
    * **Ứng dụng Desktop:** **Electron**.
* **Backend (Main Process):**
    * **Môi trường:** **Node.js**.
* **Giao thức/Thư viện:**
    * **SSH & Terminal:** `ssh2`, `xterm.js`.
    * **SFTP & File Transfer:** `sftp-client` hoặc tương đương.
    * **Quản lý Trạng thái:** **[VD: Redux, Zustand, hoặc đơn giản là React Context/State.]**

---

## 3. ✨ Các Tính năng Chính (Key Features)

### 3.A. Tính năng Kế thừa (Từ electerm gốc)

* Giao diện **Terminal/SSH** đầy đủ chức năng.
* **SFTP** file manager tích hợp.
* Quản lý **Connections/Bookmarks** và **Jump Server**.
* Hỗ trợ **Proxy** (SOCKS5/HTTP).

### 3.B. Tính năng Đang Phát triển (Phần mở rộng)

| Tính năng | Mô tả Chi tiết | Công nghệ Mới |
| :--- | :--- | :--- |
| **[Tính năng 1]** | **[VD: Cloud Service Explorer]** - Cho phép kết nối và quản lý các tài nguyên (EC2 instances, S3 buckets) từ AWS/Azure thông qua API. | **[VD: AWS SDK, Azure SDK, thư viện UI Tree View mới.]** |
| **[Tính năng 2]** | **[VD: Tích hợp Git Flow Viewer]** - Hiện thị lịch sử commit và nhánh (branch) của repo hiện tại dưới dạng cây (tree). | **[VD: `git` CLI, thư viện xử lý `git log`...]** |
| **[Tính năng 3]** | [Mô tả tính năng thứ ba của bạn] | [Công nghệ/Thư viện mới liên quan] |

---

## 4. 📂 Cấu trúc Code Quan trọng

Dự án tuân theo cấu trúc phân chia **Main Process (Backend)** và **Render Process (Frontend)** của Electron:

* `src/client/`: Chứa toàn bộ code **React** (Frontend/Render Process). Nơi hiển thị giao diện, terminal, và SFTP manager.
    * *Mô-đun liên quan:* `src/client/components/CloudExplorer.tsx`
* `src/server/`: Chứa code **Node.js** (Backend/Main Process). Nơi xử lý các tác vụ nặng (SSH/SFTP, gọi API Cloud) và tương tác với hệ điều hành.
    * *Mô-đun liên quan:* `src/server/cloud-api-handler.ts`
* `src/common/`: Chứa các **TypeScript Interfaces** và hàm tiện ích (Utilities) được chia sẻ giữa Client và Server.
* `[Thêm thư mục quan trọng khác nếu có, VD: src/custom-plugin/]`

---

## 5. ⚠️ Các Vấn đề và Thách thức Hiện tại (To-do/Challenges)

Chúng tôi đang tập trung giải quyết các vấn đề sau:

1.  **Hiệu suất SFTP:** **[VD: Giao diện SFTP bị lag khi tải thư mục có hơn 10,000 file.]** Cần tối ưu hóa việc đọc thư mục lớn (`readdir`) và render danh sách (`virtualization`).
2.  **Bảo mật:** **[VD: Cần cải thiện cơ chế mã hóa cho các khóa SSH được lưu trữ.]** Xem xét sử dụng `keytar` (trên Node.js) để tận dụng trình quản lý khóa gốc của hệ điều hành.
3.  **Ổn định:** **[VD: Tính năng Cloud Explorer đôi khi bị timeout khi gọi API.]** Cần tăng cường cơ chế `retry` và xử lý lỗi (`error handling`) cho các lời gọi API. 

## Chú ý
Luôn đảm bảo rằng các thay đổi của bạn tuân thủ các tiêu chuẩn mã hóa hiện có và không làm gián đoạn các tính năng hiện tại của electerm.

Luôn trả lời bằng tiếng Việt.
---
