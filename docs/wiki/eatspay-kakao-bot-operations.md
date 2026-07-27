# EatsPay 전용 카카오봇 운영

갱신: 2026-07-25 KST

## 책임 경계

- 프로젝트 원본: `kakao/eatspay_kakao_bot.py`
- 운영 파일: `/home/mino/eatspay-kakao/eatspay_kakao_bot.py`
- 전용 서비스: `eatspay-kakao-bot.service`
- Iris/Redroid 송신: 기존 `http://127.0.0.1:3000/reply` 재사용
- Iris 수신: 단일 웹훅 제약 때문에 기존 5000 서비스가 원본 payload를 `127.0.0.1:5010/webhook`으로 fail-open 전달
- 애플 식단, 행사, 교육, 학부모 상태와 함수는 전용 서비스에서 import하거나 참조하지 않는다.

## 소유 기능

- `!이츠페이`, `!업로드`
- 지정 방의 TID Excel 첨부 다운로드 및 EatsPay 내부 API 업로드
- `/api/internal/kakao/account-approvals/tid-upload-events` 폴링과 완료 알림
- `/api/internal/kakao/notification-events` 폴링과 결제/입금 알림
- TID 업로드방 `473042992214661`, 모비스테스트방 `380705904900190`
- 매출 알림방 `474536781052768` (`이츠페이매출알림방`)

## TID 업로드 및 다음 링크 알림 기준

- TID 업로드방에서 엑셀 첨부를 감지하면 업로더와 파일명을 TID 업로드방 및 모비스테스트방에 알린다.
- 서버 업로드 성공·실패와 서버 반영 결과도 두 방에 전달한다. 입장·퇴장 메시지는 전달하지 않는다.
- 수동 `!이츠페이`로 생성한 다운로드/업로드 링크는 TID 업로드방과 모비스테스트방에 같은 내용을 한 번씩 보낸다.
- 관리자 계좌 검증 화면에서 승인 또는 반려 처리 후 검증 대기 건수가 `0`이 되고, TID 내보내기 대기 행이 1건 이상 있을 때 다음 다운로드/업로드 링크를 자동 생성한다.
- TID 엑셀 업로드 완료는 반영 결과만 알리며 다음 링크 생성 조건으로 사용하지 않는다.
- 자동 링크의 본문과 방별 전달 완료 상태를 `/home/mino/eatspay_tid_event_state.json`에 먼저 기록한다. 일부 방 전송이 실패하면 새 링크를 만들지 않고 저장된 같은 링크의 미전송 방만 재시도한다.
- 내보내기 대기 행 조합으로 만든 고유 큐 키를 서버 이벤트와 상태 파일에 보관한다. 같은 0건 상태가 다시 확인되거나 서비스가 재시작되어도 같은 큐의 자동 링크를 반복 발송하지 않는다.
- `EATSPAY_TID_NOTIFY_ROOMS` 운영값은 `473042992214661,380705904900190`이다.

## 결제·입금 알림 기준

- CH PAYWAY 정산 확인 이벤트는 메시지를 보내지 않고 이체 소요시간 계산의 시작 시각으로만 사용한다.
- GH Payments 이체 성공 이벤트가 들어오면 각 알림방에 메시지 2개를 보낸다.
  1. 해당 업체의 이체 성공 상세, 상위대리점, 정산 확인부터 이체 성공까지 걸린 시간
  2. 한국시간 당일 전체 가맹점의 성공 결제 누적 매출과 결제 건수
- 알림 대상은 모비스테스트방 `380705904900190`과 이츠페이매출알림방 `474536781052768`이다.
- 방별·메시지별 전달 완료 상태를 상태 파일에 기록해 일부 전송 실패 후 재시도에서 이미 성공한 메시지를 건너뛴다.

## 환경과 상태 승계

토큰은 `/home/mino/.bot_env`의 기존 `KAKAO_TXID_TOKEN`을 그대로 사용한다. 값은 문서나 저장소에 복사하지 않는다. 전용 override는 `/home/mino/eatspay-kakao.env`에 둔다.

상태 파일은 이동하거나 초기화하지 않고 아래 기존 파일을 그대로 연다.

- `/home/mino/eatspay_tid_event_state.json`
- `/home/mino/eatspay_notification_event_state.json`

상태 저장은 임시 파일을 쓴 뒤 `os.replace`로 교체한다.

## 중복 방지 전환 규칙

1. 새 서비스는 반드시 `EATSPAY_POLLERS_ENABLED=0`으로 먼저 기동한다.
2. `/health`, py_compile, unit test, API 읽기 검증을 완료한다.
3. 기존 `iris-kakao-bot.service`를 멈춘 상태에서만 새 poller를 `1`로 바꾼다.
4. 기존 파일의 두 poller thread 시작과 EatsPay 명령/첨부 처리 코드를 제거한다.
5. 새 서비스를 먼저 시작하고 기존 서비스를 다시 시작한다.
6. 두 상태 파일의 cursor가 유지되고 한 프로세스만 폴링하는지 로그와 process/thread 상태로 확인한다.

## 검증 명령

```powershell
python .\test\test_eatspay_kakao_bot.py
python .\test\test_legacy_webhook_forwarder.py
$env:PYTHONPYCACHEPREFIX='C:\tmp\eatspay-pycache'
python -m py_compile .\kakao\eatspay_kakao_bot.py .\kakao\legacy_webhook_forwarder.py
```

```bash
python3 -m py_compile /home/mino/eatspay-kakao/eatspay_kakao_bot.py
systemctl is-active eatspay-kakao-bot.service iris-kakao-bot.service iris-bridge.service
curl -s http://127.0.0.1:5010/health
journalctl -u eatspay-kakao-bot.service -n 80 --no-pager
```

API 검증은 기존 cursor를 query로 넘기는 GET만 사용한다. `export-link`는 새 내보내기 세션을 만들 수 있으므로 운영 검증에서 호출하지 않는다. 실제 결제, 입금, 파일 업로드, 운영방 메시지 발송은 사용자 승인 없이 만들지 않는다.

## 롤백

새 poller를 즉시 `0`으로 내리고 서비스를 중지한다. 백업한 기존 `iris_kakao_bot.py`를 복원해 `py_compile` 후 `iris-kakao-bot.service`를 재시작한다. `iris-bridge.service`는 이상이 없으면 재시작하지 않는다. 상태 파일은 롤백 과정에서도 삭제하거나 되감지 않는다.
