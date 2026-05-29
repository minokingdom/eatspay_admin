# AGENTS.md

> [!NOTE]
> 이 파일은 사람이 아닌 **AI 코딩 에이전트(Eats Pay Agent Team)**를 위해 작성된 전용 프로젝트 헌장(README for Agents)입니다.
> 에이전트가 이 코드베이스를 탐색하고 기능을 개발할 때, 본 설계도에 기재된 역할 분담, 세션 유지 정책, 그리고 통신 규칙을 100% 준수해야 합니다.

---

## 1. 에이전트 팀 아키텍처 (Agent Team Architecture)

본 프로젝트는 **'오케스트레이터-스페셜리스트(Supervisor & Specialist)'** 모델을 채택하여 복잡한 태스크를 분할 정복합니다. Eats Pay 프로젝트에 특화된 4인 에이전트 팀의 역할은 다음과 같습니다.

```mermaid
graph TD
    Orchestrator[메인 오케스트레이터 Orchestrator] -->|작업 할당 및 세션 관리| Planner[기획 & 라우팅 플래너 Planner]
    Orchestrator -->|코드 생성 및 DOM 작업 지시| Developer[UI/UX 개발자 Developer]
    Orchestrator -->|기능 통과 여부 검증 및 예외 분석| Validator[수수료/비즈니스 검증자 Validator]
    Developer -.->|DOM 구조 및 JS 상태| Validator
    Validator -.->|피드백 루프| Orchestrator
```

### 👥 에이전트 프로필 및 책임 영역

1.  **메인 오케스트레이터 (Main Orchestrator - `orchestrator`)**
    *   **역할**: 전체 작업의 총괄 감독 및 상태 관리자.
    *   **핵심 의무**:
        *   사용자의 거대한 요구사항을 분석하여 단일 세션(Context)이 유실되지 않도록 관리.
        *   Planner, Developer, Validator의 상태를 기록하고 피드백 루프를 제어.
        *   각 에이전트 간의 데이터 통신을 조율하며 최종 검증 승인권(Sign-off)을 보유.

2.  **기획 & 라우팅 플래너 (UI/UX Router Planner - `planner`)**
    *   **역할**: 화면 전환 애니메이션 정책, 네비게이션 라우팅 설계자.
    *   **핵심 의무**:
        *   15개 서브 스크린(`index.html` 내 `.screen`)의 흐름과 되돌리기(`btn-back`) 세션 히스토리 보존 확인.
        *   사용자 여정(User Journey)상 꼬이는 라우팅 경로가 없는지 검증하고 동작 스펙 정의.

3.  **UI/UX 개발자 (Core Frontend Developer - `developer`)**
    *   **역할**: HTML 구조 조작, HSL 기반 프리미엄 CSS 제어 및 JS 인터랙션 구현 전문가.
    *   **핵심 의무**:
        *   `style.css`와 `js/app.js`에서 DOM을 조작하고 실시간 수수료 연동, 모달 온/오프 인터랙션 코드를 작성.
        *   태그 불일치 방지 및 코드 내 중복 스크립트 블록 완전 차단.

4.  **수수료/비즈니스 검증자 (Business Validator - `validator`)**
    *   **역할**: 실시간 비즈니스 데이터 무결성 검사 및 QA.
    *   **핵심 의무**:
        *   충전 수수료율(4.602%) 실시간 연산, 카드/가상계좌 CRUD 로직이 명세서대로 동작하는지 검증.
        *   로그 파일 점검, JS 콘솔 에러 유무 확인 및 닫는 태그(`</div>`) 검사 등 코드 무결성 검증.

---

## 2. 에이전트 간 통신 & 세션 유지 프로토콜

에이전트가 협업하여 세션을 유지하고 통신할 때 반드시 다음 통신 포맷과 상태 관리 원칙을 준수해야 합니다.

### 🔄 1단계: 세션 메타데이터 구조 (Session State Schema)
에이전트들은 `js/app.js` 내부의 전역 상태 객체(`state`)와 유사하게, 자신들의 태스크 상태를 공유 세션 메타데이터로 모니터링합니다.

*   **현재 화면 상태**: `state.currentScreen`
*   **히스토리 경로**: `state.history` (되돌리기 버튼 이벤트 추적용)
*   **통신 전달 객체 (Payload)**:
    ```json
    {
      "session_id": "eats-pay-session-2026",
      "active_agent": "developer",
      "target_screen": "charge",
      "payload": {
        "calculated_fee_rate": 0.04602,
        "input_amount": "100,000",
        "output_amount": "104,602"
      }
    }
    ```

### 💬 2단계: 에이전트 협업 커뮤니케이션 룰
*   **Developer**가 코드를 수정한 후에는 즉시 **Validator**에게 바통을 넘깁니다:
    > "Developer가 `index.html` L1429 영역의 닫히지 않았던 cs-promo div 블록을 수선 완료했습니다. Validator는 수선된 DOM 트리 밸런스 및 콘솔 컴파일 에러 유무를 즉시 검증하십시오."
*   **Validator**는 검증 결과를 **Orchestrator**에게 피드백합니다:
    > "Validator 검증 완료. `Balance of div tags: 0` 확인. JS 구문 컴파일 테스트 통과. 오케스트레이터에게 최종 화면 전환 통합 확인 및 배포 승인을 요청합니다."

---

## 3. 코드베이스 규칙 & 중요 경계 (Important Boundaries)

*   **클라이언트 전용 앱**:
    *   이 프로젝트는 별도의 DB 서버 없이 완전한 클라이언트 단독 프로토타입(`index.html`, `js/app.js`, `css/style.css`)으로 실행됩니다.
    *   모든 상태 변화(카드 삭제, 내역 추가, 가상계좌 추가 등)는 DOM 동적 렌더링 및 `state` 변수를 활용해 임시 보존 처리합니다.
*   **HTML & CSS 샌드박스 구조**:
    *   모든 화면은 `#app-shell` -> `.phone-frame` -> `.screen-container` 내부에 종속적으로 렌더링되어야 합니다. 모바일 프레임 범위를 벗어나는 absolute/fixed 요소를 제한합니다.
*   **중복 스크립트 작성 절대 금지**:
    *   이전 턴의 sequential edit로 인해 `js/app.js` 하단에 동일 기능의 이벤트 바인딩이 중복 선언되는 현상을 엄격히 금지합니다. 수정 전 항상 파일의 전반적인 구조를 확인하십시오.

---

## 4. 빌드, 테스트 및 실행 가이드

*   **로컬 개발 서버 구동**: `python -m http.server 8080`
*   **검증 및 컴파일 검사**: `node -e "const js = fs.readFileSync('js/app.js', 'utf8'); new Function(js);"`
