// ==========================================
// eats PAY - App Navigation & Interaction
// ==========================================

'use strict';

// --- State ---
const state = {
  currentScreen: 'splash',
  history: [],
  smsTimer: null,
  smsCountdown: 180,
  formData: {
    bizNumber: '',
    userId: '',
    password: '',
    phone: '',
    storeName: '',
    ceoName: '',
    address: '',
    tel: '',
    terms: { all: false, usage: false, privacy: false }
  }
};

// --- DOM Helpers ---
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

// --- Screen Navigation ---
function navigate(screenId, direction = 'forward') {
  const current = $(`#screen-${state.currentScreen}`);
  const next = $(`#screen-${screenId}`);
  if (!next || screenId === state.currentScreen) return;

  if (direction === 'forward') {
    state.history.push(state.currentScreen);
    current.classList.remove('active');
    next.classList.add('active', 'slide-in-right');
    setTimeout(() => next.classList.remove('slide-in-right'), 350);
    window.history.pushState({ screen: screenId }, '');
  } else {
    current.classList.remove('active');
    next.classList.add('active', 'slide-in-left');
    setTimeout(() => next.classList.remove('slide-in-left'), 350);
  }

  state.currentScreen = screenId;
  updateBottomNav(screenId);
}

function goBack() {
  if (state.history.length === 0) return;
  const prev = state.history.pop();
  navigate(prev, 'backward');
  state.history.pop(); // remove duplicate pushed by navigate
}

function updateBottomNav(screenId) {
  $$('.nav-item').forEach(btn => btn.classList.remove('active'));
  const isHome = ['home', 'charge'].includes(screenId);
  const isMyFlow = ['my', 'find-id', 'find-pw', 'card-list', 'card-add', 'payment-history', 'vaccount-list', 'vaccount-add', 'edit-myinfo', 'login'].includes(screenId);
  const isCsFlow = ['cs-main', 'cs-guide', 'cs-promo'].includes(screenId);
  
  if (isHome) {
    $$('[id^="nav-home"]').forEach(el => el.classList.add('active'));
  } else if (isMyFlow) {
    $$('[id^="nav-my"]').forEach(el => el.classList.add('active'));
  } else if (isCsFlow) {
    $$('[id^="nav-cs"]').forEach(el => el.classList.add('active'));
  }
}

function showToast(msg) {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

function formatPhone(val) {
  const cleaned = val.replace(/\D/g, '');
  const match = cleaned.match(/^(\d{3})(\d{3,4})(\d{4})$/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  return cleaned;
}

function startSmsCountdown(el) {
  if (!el) return;
  clearInterval(state.smsTimer);
  state.smsCountdown = 180;
  el.style.display = 'block';
  
  state.smsTimer = setInterval(() => {
    state.smsCountdown--;
    const m = Math.floor(state.smsCountdown / 60);
    const s = state.smsCountdown % 60;
    el.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    if (state.smsCountdown <= 0) {
      clearInterval(state.smsTimer);
      el.textContent = '0:00';
    }
  }, 1000);
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {

  // Simulate Splash loading
  setTimeout(() => {
    navigate('login');
  }, 2500);

  // Hardware/Virtual Device back button history bindings
  window.history.replaceState({ screen: 'splash' }, '');
  window.addEventListener('popstate', (event) => {
    if (state.history.length > 0) {
      goBack();
    }
  });

  // Global Back Buttons
  $$('.btn-back').forEach(btn => btn.addEventListener('click', goBack));

  // Bottom Nav & Home Banner Click Bindings
  $$('[id^="nav-home"]').forEach(btn => btn.addEventListener('click', () => navigate('home')));
  $$('[id^="nav-my"]').forEach(btn => btn.addEventListener('click', () => navigate('my')));
  $$('[id^="nav-cs"]').forEach(btn => btn.addEventListener('click', () => navigate('cs-main')));
  $('#home-login-banner')?.addEventListener('click', () => navigate('login')); // Goes to login!
  
  // --------- LOGIN SCREEN ---------
  $('#to-register')?.addEventListener('click', () => navigate('reg-step1'));
  $('#to-find-id')?.addEventListener('click', () => navigate('find-id'));
  $('#to-find-pw')?.addEventListener('click', () => navigate('find-pw'));
  
  $('#login-submit-btn')?.addEventListener('click', async () => {
    const btn = $('#login-submit-btn');
    const idInput = $('#login-id');
    const pwInput = $('#login-pw');
    const username = idInput ? idInput.value.trim() : '';
    const password = pwInput ? pwInput.value.trim() : '';

    if (!username || !password) {
      showToast('아이디와 비밀번호를 입력해주세요.');
      return;
    }

    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<div class="spinner" style="border-top-color: white; width: 16px; height: 16px;"></div>';
    btn.disabled = true;

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email: username, password })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.message || '로그인에 실패했습니다.');
      }

      const resPayload = await response.json();
      if (resPayload.success && resPayload.data && resPayload.data.accessToken) {
        sessionStorage.setItem('accessToken', resPayload.data.accessToken);
        showToast('로그인에 성공했습니다.');
        
        // Fetch and load initial home screen stats/data if needed
        if (typeof fetchPaymentHistory === 'function') {
          fetchPaymentHistory();
        }
        
        navigate('home');
        state.history = [];
      } else {
        throw new Error('토큰 정보가 없습니다.');
      }
    } catch (err) {
      showToast(err.message);
    } finally {
      btn.innerHTML = '로그인';
      btn.disabled = false;
    }
  });

  // --------- SOCIAL LOGINS ---------
  const handleSocialLogin = (btnId, name) => {
    const btn = $(btnId);
    if (!btn) return;
    btn.addEventListener('click', () => {
      const originalHtml = btn.innerHTML;
      btn.innerHTML = '<div class="spinner" style="border-top-color: var(--green-primary); width: 16px; height: 16px;"></div>';
      showToast(`${name} 간편 인증을 진행합니다...`);
      setTimeout(() => {
        btn.innerHTML = originalHtml;
        showToast(`${name} 인증이 완료되었습니다.`);
        navigate('home');
        state.history = [];
      }, 1200);
    });
  };

  handleSocialLogin('#btn-naver', '네이버');
  handleSocialLogin('#btn-kakao', '카카오');
  handleSocialLogin('#btn-google', '구글');

  // --------- REG STEP 1 ---------
  // Disable next button initially until query check
  const nextBtn = $('#reg-to-step2');
  if (nextBtn) nextBtn.disabled = true;

  $('#reg-biz-query')?.addEventListener('click', async () => {
    const bizNo = $('#reg-biz-no')?.value;
    if (!bizNo || bizNo.replace(/[^0-9]/g, '').length < 10) {
      showToast('사업자등록번호 10자리를 입력해주세요.');
      return;
    }

    const queryBtn = $('#reg-biz-query');
    queryBtn.innerHTML = '<div class="spinner" style="border-top-color: var(--green-primary); width:16px; height:16px;"></div>';
    queryBtn.disabled = true;

    try {
      const response = await fetch('/api/auth/verify-business', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessNumber: bizNo })
      });

      const result = await response.json();
      if (response.ok) {
        queryBtn.textContent = '조회 완료';
        showToast(result.message || '국세청 기준 정상 영업 가맹점으로 정상 조회되었습니다.');
        
        state.formData.bizNumber = bizNo;
        if (nextBtn) nextBtn.disabled = false;
      } else {
        queryBtn.textContent = '조회하기';
        queryBtn.disabled = false;
        showToast(result.error?.message || '유효하지 않은 사업자등록번호입니다.');
        if (nextBtn) nextBtn.disabled = true;
      }
    } catch (err) {
      console.error(err);
      queryBtn.textContent = '조회하기';
      queryBtn.disabled = false;
      showToast('네트워크 오류가 발생했습니다. 다시 시도해주세요.');
      if (nextBtn) nextBtn.disabled = true;
    }
  });

  $('#reg-to-step2')?.addEventListener('click', () => {
    const bizNo = $('#reg-biz-no')?.value;
    if (!bizNo || bizNo.length < 10) {
      showToast('사업자등록번호 10자리를 입력해주세요.');
      return;
    }
    navigate('reg-step2');
  });

  // --------- REG STEP 2 ---------
  const phoneInput = $('#reg-phone');
  phoneInput?.addEventListener('input', function() {
    this.value = formatPhone(this.value);
  });

  $('#reg-send-sms')?.addEventListener('click', () => {
    const phone = $('#reg-phone')?.value;
    if (!phone || phone.length < 10) {
      showToast('휴대폰번호를 올바르게 입력해주세요.');
      return;
    }
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    state.smsCode = code;
    showToast(`[이츠페이] 인증번호 [${code}]가 발송되었습니다.`);
    
    // Automatically autofill the input field and pop a browser alert so the user never misses the test code!
    const smsInput = $('#reg-sms-input');
    if (smsInput) smsInput.value = code;
    
    alert(`[이츠페이 테스트 안내]\n인증번호가 발송되었습니다.\n인증번호: ${code}\n\n* 테스트 편의를 위해 인증번호가 입력창에 자동으로 입력되었습니다.`);
  });

  // --------- REG STEP 3 ---------
  $('#reg-step2-next')?.addEventListener('click', () => {
    const id = $('#reg-id')?.value;
    const pw = $('#reg-pw')?.value;
    const phone = $('#reg-phone')?.value;
    const sms = $('#reg-sms-input')?.value;

    if (!id || !id.includes('@')) {
      showToast('올바른 이메일 형식의 아이디를 입력해주세요.');
      return;
    }
    if (!pw || pw.length < 4) {
      showToast('비밀번호를 4자리 이상 입력해주세요.');
      return;
    }
    if (!phone || phone.length < 10) {
      showToast('휴대폰번호를 올바르게 입력해주세요.');
      return;
    }
    if (!sms) {
      showToast('인증번호를 입력해주세요.');
      return;
    }
    if (sms !== state.smsCode) {
      showToast('인증번호가 일치하지 않습니다.');
      return;
    }
    navigate('reg-step3');
  });

  $('#reg-step3-next')?.addEventListener('click', () => {
    const storeName = $('#reg-store-name')?.value;
    const ceoName = $('#reg-ceo-name')?.value;
    const address = $('#reg-address')?.value;
    const tel = $('#reg-tel')?.value;

    if (!storeName) {
      showToast('상호명을 입력해주세요.');
      return;
    }
    if (!ceoName) {
      showToast('대표자명을 입력해주세요.');
      return;
    }
    if (!address) {
      showToast('사업장주소를 입력해주세요.');
      return;
    }
    if (!tel) {
      showToast('전화번호를 입력해주세요.');
      return;
    }
    navigate('reg-step4');
  });

  $('#upload-biz-license')?.addEventListener('click', () => {
    showToast('파일 선택 창이 열립니다');
  });
  
  $('#upload-pos-screen')?.addEventListener('click', () => {
    showToast('파일 선택 창이 열립니다');
  });

  // --------- REG STEP 4 ---------
  $('#term-all')?.addEventListener('change', function() {
    const isChecked = this.checked;
    $$('.term-checkbox').forEach(cb => cb.checked = isChecked);
  });

  $$('.term-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      const allChecked = $$('.term-checkbox').every(c => c.checked);
      $('#term-all').checked = allChecked;
    });
  });

  // --------- REG STEP 4 checkbox bindings ---------
  const toggleCb = (el, force = null) => {
    if (force !== null) {
      if (force) el.classList.add('checked');
      else el.classList.remove('checked');
    } else {
      el.classList.toggle('checked');
    }
  };

  $('#term-all-row')?.addEventListener('click', () => {
    const cb = $('#term-all-cb');
    cb.classList.toggle('checked');
    const isChecked = cb.classList.contains('checked');
    toggleCb($('#term-usage-cb'), isChecked);
    toggleCb($('#term-privacy-cb'), isChecked);
  });

  const updateTermAll = () => {
    const usage = $('#term-usage-cb').classList.contains('checked');
    const privacy = $('#term-privacy-cb').classList.contains('checked');
    toggleCb($('#term-all-cb'), usage && privacy);
  };

  $('#term-usage-row')?.addEventListener('click', () => {
    toggleCb($('#term-usage-cb'));
    updateTermAll();
  });

  $('#term-privacy-row')?.addEventListener('click', () => {
    toggleCb($('#term-privacy-cb'));
    updateTermAll();
  });

  // Keep Login checkbox binding on login screen
  $('#keep-login-row')?.addEventListener('click', () => {
    toggleCb($('#keep-login-cb'));
  });

  $('#register-submit')?.addEventListener('click', async () => {
    const usage = $('#term-usage-cb').classList.contains('checked');
    const privacy = $('#term-privacy-cb').classList.contains('checked');
    if (!usage || !privacy) {
      showToast('필수 약관에 모두 동의하셔야 합니다.');
      return;
    }

    const businessNumber = $('#reg-biz-no')?.value;
    const email = $('#reg-id')?.value;
    const password = $('#reg-pw')?.value;
    const phone = $('#reg-phone')?.value;
    const storeName = $('#reg-store-name')?.value;
    const ceoName = $('#reg-ceo-name')?.value;
    const address = $('#reg-address')?.value;
    const tel = $('#reg-tel')?.value;

    const btn = $('#register-submit');
    btn.innerHTML = '<div class="spinner"></div>';
    btn.disabled = true;

    try {
      const response = await fetch('http://localhost:3000/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email,
          password,
          phone,
          storeName,
          ceoName,
          address,
          tel,
          businessNumber
        })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || '회원가입에 실패했습니다.');
      }

      showToast('가입이 완료되었습니다! 본사 승인 대기 중입니다.');
      state.history = [];
      navigate('login');
    } catch (err) {
      showToast(err.message);
    } finally {
      btn.textContent = '가입하기';
      btn.disabled = false;
    }
  });

  // --------- FIND ID ---------
  const findIdPhone = $('#find-id-phone');
  findIdPhone?.addEventListener('input', function() {
    this.value = formatPhone(this.value);
  });

  $('#find-id-send-sms')?.addEventListener('click', () => {
    const phone = findIdPhone?.value;
    if (!phone || phone.length < 10) {
      showToast('휴대번호를 올바르게 입력해주세요.');
      return;
    }
    showToast('인증번호가 발송되었습니다.');
    $('#find-id-sms-container').style.display = 'block';
  });

  $('#find-id-submit')?.addEventListener('click', () => {
    const sms = $('#find-id-sms-input')?.value;
    if (!sms || sms.length < 6) {
      showToast('인증번호 6자리를 올바르게 입력해주세요.');
      return;
    }
    showToast('등록된 아이디는 eats***r 입니다.');
    setTimeout(() => {
      navigate('login');
    }, 2000);
  });

  // --------- FIND PW ---------
  const findPwPhone = $('#find-pw-phone');
  findPwPhone?.addEventListener('input', function() {
    this.value = formatPhone(this.value);
  });

  $('#find-pw-send-sms')?.addEventListener('click', () => {
    const id = $('#find-pw-id')?.value;
    const phone = findPwPhone?.value;
    if (!id) { showToast('아이디를 입력해주세요.'); return; }
    if (!phone || phone.length < 10) { showToast('휴대번호를 입력해주세요.'); return; }
    showToast('인증번호가 발송되었습니다.');
    $('#find-pw-sms-container').style.display = 'block';
  });

  $('#find-pw-submit')?.addEventListener('click', () => {
    const id = $('#find-pw-id')?.value;
    const phone = findPwPhone?.value;
    const sms = $('#find-pw-sms-input')?.value;
    const pw = $('#find-pw-new')?.value;
    const pw2 = $('#find-pw-new2')?.value;
    
    if (!id) { showToast('아이디를 입력해주세요.'); return; }
    if (!phone) { showToast('휴대번호를 입력해주세요.'); return; }
    if ($('#find-pw-sms-container').style.display !== 'none' && (!sms || sms.length < 6)) {
      showToast('인증번호를 입력해주세요.');
      return;
    }
    if (!pw) { showToast('새비밀번호를 입력해주세요.'); return; }
    if (pw !== pw2) { showToast('비밀번호가 일치하지 않습니다.'); return; }
    
    const btn = $('#find-pw-submit');
    btn.innerHTML = '<div class="spinner"></div>';
    setTimeout(() => {
      btn.textContent = '비밀번호 재설정';
      showToast('비밀번호가 안전하게 재설정되었습니다.');
      state.history = [];
      navigate('login');
    }, 1500);
  });

  // --------- CARD MANAGEMENT ---------
  // Navigations
  $('#my-card-manage-btn')?.addEventListener('click', () => navigate('card-list'));
  $('#btn-to-card-add')?.addEventListener('click', () => navigate('card-add'));

  // Card screen sub navs are covered by dynamic bindings

  // Card Type Toggles
  const btnPersonal = $('#btn-card-type-personal');
  const btnCorp = $('#btn-card-type-corp');
  const labelIdentity = $('#label-card-identity');
  const inputIdentity = $('#add-card-identity');

  btnPersonal?.addEventListener('click', () => {
    btnPersonal.classList.add('active');
    btnPersonal.style.borderColor = '#3a9430';
    btnPersonal.style.color = '#3a9430';
    btnCorp.classList.remove('active');
    btnCorp.style.borderColor = 'var(--border-color)';
    btnCorp.style.color = 'var(--text-secondary)';
    
    labelIdentity.textContent = '생년월일';
    inputIdentity.placeholder = '6자리(예:940403)';
  });

  btnCorp?.addEventListener('click', () => {
    btnCorp.classList.add('active');
    btnCorp.style.borderColor = '#3a9430';
    btnCorp.style.color = '#3a9430';
    btnPersonal.classList.remove('active');
    btnPersonal.style.borderColor = 'var(--border-color)';
    btnPersonal.style.color = 'var(--text-secondary)';
    
    labelIdentity.textContent = '법인등록번호 / 사업자번호';
    inputIdentity.placeholder = '10자리 또는 13자리 입력';
  });

  // Card Number Auto Formatting (xxxx-xxxx-xxxx-xxxx)
  const cardNumInput = $('#add-card-number');
  cardNumInput?.addEventListener('input', function() {
    let val = this.value.replace(/\D/g, '');
    let formatted = [];
    for (let i = 0; i < val.length && i < 16; i += 4) {
      formatted.push(val.substring(i, i + 4));
    }
    this.value = formatted.join('-');
  });

  // Add Card Submission
  $('#add-card-submit')?.addEventListener('click', async () => {
    const cardNum = $('#add-card-number')?.value;
    const cardPw = $('#add-card-pw')?.value;
    const month = $('#add-card-month')?.value;
    const year = $('#add-card-year')?.value;
    const identity = $('#add-card-identity')?.value;
    const alias = $('#add-card-alias')?.value || '새카드';

    if (!cardNum || cardNum.length < 19) { showToast('카드번호 전체를 입력해주세요.'); return; }
    if (!cardPw || cardPw.length < 2) { showToast('비밀번호 앞 2자리를 입력해주세요.'); return; }
    if (!month || !year) { showToast('유효기간을 선택해주세요.'); return; }
    if (!identity) { showToast('인증번호(생년월일/사업자번호)를 입력해주세요.'); return; }

    const btn = $('#add-card-submit');
    btn.innerHTML = '<div class="spinner"></div>';
    btn.disabled = true;

    try {
      const accessToken = sessionStorage.getItem('accessToken') || '';
      const response = await fetch('http://localhost:3000/api/card/register', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          cardNumber: cardNum.replace(/-/g, ''),
          cardPw,
          expiryMonth: month,
          expiryYear: year,
          identity,
          alias
        })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || '카드 등록에 실패했습니다.');
      }

      const resJson = await response.json();
      showToast('카드가 성공적으로 등록되었습니다.');

      // Create new card card elements
      const newCardHtml = `
        <div style="border: 1.5px solid var(--border-color); border-radius: var(--radius); padding: 16px; background: var(--bg-white); display: flex; justify-content: space-between; align-items: center; height: 110px; opacity:0; transform:translateY(10px); transition:all 0.4s;">
          <!-- 왼쪽: 실물 카드 디자인 -->
          <div style="width: 140px; height: 80px; border: 1px solid #ccc; border-radius: 6px; padding: 10px; display: flex; flex-direction: column; justify-content: space-between; background: #fafafa; box-shadow: 1px 1px 4px rgba(0,0,0,0.05);">
            <div style="display: flex; align-items: center; gap: 4px;">
              <span style="font-size: 11px; font-weight: 800; color: #333;">${resJson.data.cardName}</span>
            </div>
            <div style="font-size: 10px; font-family: monospace; color: #555; letter-spacing: 0.5px;">${resJson.data.maskedNumber}</div>
          </div>
          <!-- 오른쪽: 별칭 및 액션 버튼 -->
          <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 12px;">
            <span style="border: 1.5px solid #999; padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 800; color: #555;">${resJson.data.alias}</span>
            <div style="display: flex; gap: 6px;">
              <button class="btn-card-edit" style="background: white; border: 1px solid var(--border-color); padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 700; color: var(--text-secondary); cursor: pointer;">수정</button>
              <button class="btn-card-delete" style="background: white; border: 1px solid var(--border-color); padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 700; color: #e53935; cursor: pointer;">삭제</button>
            </div>
          </div>
        </div>
      `;

      const container = $('#card-items-container');
      if (container) {
        container.insertAdjacentHTML('afterbegin', newCardHtml);
        const addedEl = container.firstElementChild;
        setTimeout(() => {
          addedEl.style.opacity = '1';
          addedEl.style.transform = 'translateY(0)';
        }, 50);

        // Bind delete event to the new delete button
        addedEl.querySelector('.btn-card-delete')?.addEventListener('click', function() {
          if (confirm('이 카드를 정말 삭제하시겠습니까?')) {
            addedEl.remove();
            showToast('카드가 삭제되었습니다.');
          }
        });
        
        // Bind edit event to the new edit button
        addedEl.querySelector('.btn-card-edit')?.addEventListener('click', () => {
          showToast('카드 정보 수정은 준비 중입니다.');
        });
      }

      // Clear inputs
      if (cardNumInput) cardNumInput.value = '';
      if ($('#add-card-pw')) $('#add-card-pw').value = '';
      if ($('#add-card-month')) $('#add-card-month').value = '';
      if ($('#add-card-year')) $('#add-card-year').value = '';
      if (inputIdentity) inputIdentity.value = '';
      if ($('#add-card-alias')) $('#add-card-alias').value = '';

      navigate('card-list');
    } catch (err) {
      showToast(err.message);
    } finally {
      btn.textContent = '카드등록';
      btn.disabled = false;
    }
  });

  // Bind existing cards delete
  $$('.btn-card-delete').forEach(btn => {
    btn.addEventListener('click', function(e) {
      const cardRow = this.closest('div[style*="border"]');
      if (confirm('이 카드를 정말 삭제하시겠습니까?')) {
        cardRow.remove();
        showToast('카드가 삭제되었습니다.');
      }
    });
  });

  // Bind existing cards edit
  $$('.btn-card-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      showToast('카드 정보 수정은 준비 중입니다.');
    });
  });

  // --------- PAYMENT HISTORY ---------
  // Helper to fetch and render history
  const fetchPaymentHistory = async () => {
    const historyContainer = $('#payment-items-container');
    if (!historyContainer) return;

    historyContainer.innerHTML = `
      <div style="display:flex; justify-content:center; align-items:center; padding:40px 0;">
        <div class="spinner" style="border-top-color: var(--green-primary); width:32px; height:32px;"></div>
      </div>
    `;

    try {
      let startDate = $('#filter-start-date')?.value || '2026-05-01';
      let endDate = $('#filter-end-date')?.value || '2026-05-30';

      const accessToken = sessionStorage.getItem('accessToken') || '';
      const response = await fetch(`http://localhost:3000/api/payment/history?startDate=${startDate}&endDate=${endDate}&type=ALL`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('결제 내역을 불러오는데 실패했습니다.');
      }

      const data = await response.json();
      const items = data.data?.items || data.items || [];

      if (items.length === 0) {
        historyContainer.innerHTML = `
          <div style="text-align:center; padding:40px 20px; color:#888; font-weight:700; font-size:14px;">
            결제 내역이 존재하지 않습니다.
          </div>
        `;
        return;
      }

      historyContainer.innerHTML = items.map(item => {
        const dateStr = item.paymentDate || item.createdAt || item.date || '2026-05-19 14:23';
        const agencyName = item.agencyName || item.agency || item.title || '생각대로';
        const bankInfo = item.bankInfo || item.bank || item.account || '농협은행 000-000-0000-00000';
        const depositVal = item.amount || item.depositAmount || 100000;
        const totalVal = item.totalAmount || item.payAmount || 104602;

        return `
          <div class="payment-card" style="border: 1.5px solid var(--border-color); border-radius: var(--radius); padding: 16px; background: var(--bg-white); display: flex; flex-direction: column; gap: 6px;">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-light); padding-bottom: 8px; margin-bottom: 4px;">
              <span style="font-size: 13px; font-weight: 800; color: #333;">결제일 : ${dateStr}</span>
            </div>
            <div style="font-size: 13px; font-weight: 700; color: #555;">${agencyName}</div>
            <div style="font-size: 13px; color: #777;">${bankInfo}</div>
            <div style="font-size: 13px; color: #555;">입금금액 <span style="font-weight: 800;">${Number(depositVal).toLocaleString('ko-KR')}원</span></div>
            <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 4px;">
              <span style="font-size: 14px; font-weight: 800; color: var(--green-dark);">결제액 ${Number(totalVal).toLocaleString('ko-KR')}원</span>
            </div>
          </div>
        `;
      }).join('');

    } catch (err) {
      showToast(err.message);
      historyContainer.innerHTML = `
        <div style="text-align:center; padding:40px 20px; color:#e53935; font-weight:700; font-size:14px;">
          데이터를 불러오지 못했습니다.
        </div>
      `;
    }
  };

  // Navigations
  $('#my-payment-history-btn')?.addEventListener('click', () => {
    navigate('payment-history');
    fetchPaymentHistory();
  });

  // Tax document and search mock actions
  $('#btn-tax-doc')?.addEventListener('click', () => {
    showToast('부가세 신고자료 다운로드가 시작됩니다.');
  });

  $('#btn-date-search')?.addEventListener('click', () => {
    showToast('검색 결과가 성공적으로 반영되었습니다.');
    fetchPaymentHistory();
  });



  // --------- VIRTUAL ACCOUNT MANAGEMENT ---------
  // Navigations
  $('#my-vaccount-manage-btn')?.addEventListener('click', () => navigate('vaccount-list'));
  $('#btn-to-vaccount-add')?.addEventListener('click', () => navigate('vaccount-add'));

  // Virtual Account screen sub navs are covered by dynamic bindings

  // Delivery Agency Selection Toggles
  let selectedAgency = '생각대로';
  const agencyBtns = $$('.btn-delivery-agency');
  agencyBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      agencyBtns.forEach(b => {
        b.classList.remove('active');
        b.style.borderColor = 'var(--border-color)';
        b.style.color = 'var(--text-secondary)';
      });
      this.classList.add('active');
      this.style.borderColor = '#3a9430';
      this.style.color = '#3a9430';
      selectedAgency = this.getAttribute('data-agency');
    });
  });

  // Photo Upload Trigger
  $('#btn-vaccount-upload-photo')?.addEventListener('click', () => {
    showToast('카메라/갤러리가 열리며 사진등록이 완료되었습니다.');
  });

  // Add Virtual Account Submission
  $('#add-vaccount-submit')?.addEventListener('click', async () => {
    const bank = $('#add-vaccount-bank')?.value;
    const accountNum = $('#add-vaccount-number')?.value;

    if (!bank) { showToast('은행을 선택해주세요.'); return; }
    if (!accountNum || accountNum.length < 8) { showToast('가상계좌번호를 올바르게 입력해주세요.'); return; }

    const btn = $('#add-vaccount-submit');
    btn.innerHTML = '<div class="spinner"></div>';
    btn.disabled = true;

    try {
      const accessToken = sessionStorage.getItem('accessToken') || '';
      const formData = new FormData();
      formData.append('franchiseName', '착한치킨 송도점');
      formData.append('businessNumber', '120-00-12345');
      formData.append('bankCode', bank === '신한은행' ? '088' : '020');
      formData.append('representativeName', '홍길동');

      const response = await fetch('http://localhost:3000/api/franchise/accounts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        body: formData
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || '가상계좌 등록요청에 실패했습니다.');
      }

      showToast('가상계좌 등록요청이 접수되었습니다.');

      const newAccountHtml = `
        <div style="border: 1.5px solid var(--border-color); border-radius: var(--radius); padding: 16px 20px; background: var(--bg-white); display: flex; justify-content: space-between; align-items: center; height: 110px; opacity: 0; transform: translateY(10px); transition: all 0.4s; position: relative;">
          <!-- 가상계좌 정보 -->
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <span style="font-size: 11px; font-weight: 800; color: #888;">배달대행사 가상계좌정보</span>
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 2px;">
              <span style="background: #e53935; color: white; font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 3px; line-height: 1;">${selectedAgency}</span>
              <div style="display: flex; flex-direction: column; line-height: 1.35;">
                <span style="font-size: 14px; font-weight: 800; color: #333;">${bank}</span>
                <span style="font-size: 13px; font-weight: 700; color: #555; font-family: monospace;">${accountNum}</span>
                <span style="font-size: 12px; color: #777; font-weight: 700;">착한치킨 송도점 (승인대기)</span>
              </div>
            </div>
          </div>
          <!-- 삭제 버튼 -->
          <button class="btn-vaccount-delete" style="background: #e53935; border: none; color: white; font-size: 12px; font-weight: 800; padding: 8px 16px; border-radius: 6px; cursor: pointer; align-self: flex-end;">삭제</button>
        </div>
      `;

      const container = $('#vaccount-items-container');
      if (container) {
        container.insertAdjacentHTML('afterbegin', newAccountHtml);
        const addedEl = container.firstElementChild;
        setTimeout(() => {
          addedEl.style.opacity = '1';
          addedEl.style.transform = 'translateY(0)';
        }, 50);

        // Bind delete action to new element
        addedEl.querySelector('.btn-vaccount-delete')?.addEventListener('click', function() {
          if (confirm('이 가상계좌를 삭제하시겠습니까?')) {
            addedEl.remove();
            showToast('가상계좌가 삭제되었습니다.');
          }
        });
      }

      // Reset inputs
      if ($('#add-vaccount-bank')) $('#add-vaccount-bank').value = '';
      if ($('#add-vaccount-number')) $('#add-vaccount-number').value = '';

      navigate('vaccount-list');
    } catch (err) {
      showToast(err.message);
    } finally {
      btn.textContent = '계좌등록요청';
      btn.disabled = false;
    }
  });

  // Bind existing virtual accounts delete
  $$('.btn-vaccount-delete').forEach(btn => {
    btn.addEventListener('click', function() {
      const card = this.closest('div[style*="border"]');
      if (confirm('이 가상계좌를 삭제하시겠습니까?')) {
        card.remove();
        showToast('가상계좌가 삭제되었습니다.');
      }
    });
  });

  // --------- MEMBER INFO EDIT ---------
  // Navigations
  $('#my-edit-info-btn')?.addEventListener('click', () => navigate('edit-myinfo'));

  // Edit My Info screen sub navs are covered by dynamic bindings

  // Phone input formatting
  const editPhoneInput = $('#edit-myinfo-phone');
  editPhoneInput?.addEventListener('input', function() {
    this.value = formatPhone(this.value);
  });

  // Submit phone change
  $('#btn-edit-myinfo-phone-submit')?.addEventListener('click', () => {
    const phone = editPhoneInput?.value;
    if (!phone || phone.length < 10) {
      showToast('휴대번호를 올바르게 입력해주세요.');
      return;
    }
    showToast('휴대번호가 성공적으로 변경되었습니다.');
  });

  // Member Withdrawal
  $('#btn-edit-myinfo-withdraw')?.addEventListener('click', () => {
    if (confirm('이츠페이를 정말로 탈퇴하시겠습니까?\n탈퇴 시 모든 결제 내역 및 카드 정보가 파기됩니다.')) {
      showToast('탈퇴 처리가 정상적으로 완료되었습니다. 이용해 주셔서 감사합니다.');
      setTimeout(() => {
        state.history = [];
        navigate('login');
      }, 1500);
    }
  });

  // --------- CUSTOMER CENTER ---------
  $('#btn-cs-to-guide')?.addEventListener('click', () => navigate('cs-guide'));
  $('#btn-cs-to-promo')?.addEventListener('click', () => navigate('cs-promo'));
  $('#btn-cs-announcement')?.addEventListener('click', () => showToast('공지사항은 준비 중입니다.'));
  $('#btn-cs-kakao')?.addEventListener('click', () => showToast('카카오톡 채널 추가 화면으로 연결됩니다.'));
  $('#btn-cs-faq')?.addEventListener('click', () => showToast('자주 묻는 질문(FAQ) 화면으로 연결됩니다.'));

  // --------- DELIVERY AGENCY CHARGE ---------
  // Navigations to Charge screen
  $('#home-promo-btn')?.addEventListener('click', (e) => {
    e.stopPropagation(); // prevent home login banner click
    navigate('charge');
  });
  $('#btn-menu-charge')?.addEventListener('click', () => navigate('charge'));

  // Card Option Selector Toggle
  const cardOptions = $$('.charge-card-option');
  cardOptions.forEach(opt => {
    opt.addEventListener('click', function() {
      cardOptions.forEach(o => {
        o.classList.remove('active');
        o.style.borderColor = 'var(--border-color)';
      });
      this.classList.add('active');
      this.style.borderColor = '#3a9430';
    });
  });

  // Virtual Account Option Selector Toggle
  const vaccountOptions = $$('.charge-vaccount-option');
  vaccountOptions.forEach(opt => {
    opt.addEventListener('click', function() {
      vaccountOptions.forEach(o => {
        o.classList.remove('active');
        o.style.borderColor = 'var(--border-color)';
      });
      this.classList.add('active');
      this.style.borderColor = '#3a9430';
    });
  });

  // Real-time fee calculator (4.602% fee)
  const depositInput = $('#charge-deposit-amount');
  const payInput = $('#charge-pay-amount');

  depositInput?.addEventListener('input', function() {
    let cleanVal = this.value.replace(/\D/g, '');
    if (!cleanVal) {
      this.value = '';
      payInput.value = '0';
      return;
    }
    const numVal = parseInt(cleanVal, 10);
    this.value = numVal.toLocaleString('ko-KR');

    // 4.602% fee calculation
    const calculatedPay = Math.round(numVal * 1.04602);
    payInput.value = calculatedPay.toLocaleString('ko-KR');
  });

  // Submit charge payment
  $('#charge-submit')?.addEventListener('click', async () => {
    const depositVal = depositInput?.value;
    if (!depositVal || depositVal === '0') {
      showToast('입금할 금액을 입력해주세요.');
      return;
    }

    const activeCard = $('.charge-card-option.active');
    const activeVaccount = $('.charge-vaccount-option.active');
    if (!activeCard) { showToast('결제할 신용카드를 선택해주세요.'); return; }
    if (!activeVaccount) { showToast('입금받을 가상계좌를 선택해주세요.'); return; }

    const btn = $('#charge-submit');
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<div class="spinner" style="border-top-color: white; width: 16px; height: 16px;"></div>';
    btn.disabled = true;

    try {
      const cleanDeposit = depositVal.replace(/,/g, '');
      const amount = parseInt(cleanDeposit, 10);
      const calculatedFee = Math.floor(amount * 0.04602);
      const totalAmount = amount + calculatedFee;
      const cardId = activeCard.getAttribute('data-card') || 'bc';
      const paymentGateway = 'EATSPAY';

      const accessToken = sessionStorage.getItem('accessToken') || '';
      const response = await fetch('http://localhost:3000/api/payment/charge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'x-eatspay-signature': 'mocked_signature',
          'x-eatspay-timestamp': '1716876608'
        },
        body: JSON.stringify({
          amount,
          calculatedFee,
          totalAmount,
          cardId,
          paymentGateway
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.message || '결제 처리에 실패했습니다.');
      }

      showToast('결제가 성공적으로 완료되어 충전되었습니다.');
      
      // Dynamic payment history insert
      const agencyName = activeVaccount.getAttribute('data-agency');
      
      let bankInfo = '농협은행 0000-00000-000000';
      if (agencyName === '바로고') {
        bankInfo = '우리은행 0000-00000-000000';
      }

      const today = new Date();
      const dateStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
      const timeStr = String(today.getHours()).padStart(2, '0') + ':' + String(today.getMinutes()).padStart(2, '0');

      const newHistoryHtml = `
        <div class="payment-card" style="border: 1.5px solid var(--border-color); border-radius: var(--radius); padding: 16px; background: var(--bg-white); display: flex; flex-direction: column; gap: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-light); padding-bottom: 8px; margin-bottom: 4px;">
            <span style="font-size: 13px; font-weight: 800; color: #333;">결제일 : ${dateStr} ${timeStr}</span>
          </div>
          <div style="font-size: 13px; font-weight: 700; color: #555;">${agencyName}</div>
          <div style="font-size: 13px; color: #777;">${bankInfo}</div>
          <div style="font-size: 13px; color: #555;">입금금액 <span style="font-weight: 800;">${amount.toLocaleString('ko-KR')}원</span></div>
          <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 4px;">
            <span style="font-size: 14px; font-weight: 800; color: var(--green-dark);">결제액 ${totalAmount.toLocaleString('ko-KR')}원</span>
          </div>
        </div>
      `;

      const historyContainer = $('#payment-items-container');
      if (historyContainer) {
        historyContainer.insertAdjacentHTML('afterbegin', newHistoryHtml);
      }

      state.history = [];
      navigate('home');

    } catch (err) {
      showToast(err.message);
    } finally {
      btn.innerHTML = originalHtml;
      btn.disabled = false;
    }
  });

  // Removed Interactive Calendar Date Picker code block since separate input elements are now used.

});
