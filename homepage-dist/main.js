const header = document.querySelector("[data-header]");
const partnerForm = document.querySelector("[data-partner-form]");

const setHeaderState = () => {
  if (!header) return;
  header.toggleAttribute("data-scrolled", window.scrollY > 12);
};

window.addEventListener("scroll", setHeaderState, { passive: true });
setHeaderState();

if (partnerForm) {
  const partnerMessage = partnerForm.querySelector("[data-partner-message]");
  const partnerButton = partnerForm.querySelector('button[type="submit"]');

  const setPartnerMessage = (message, type = "") => {
    if (!partnerMessage) return;
    partnerMessage.textContent = message;
    partnerMessage.dataset.state = type;
  };

  partnerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(partnerForm);
    const payload = {
      name: String(formData.get("name") || "").trim(),
      phone: String(formData.get("phone") || "").trim(),
      region: String(formData.get("area") || "").trim(),
      deliveryAgency: String(formData.get("business") || "").trim(),
      handler: String(formData.get("source") || "").trim(),
    };

    if (Object.values(payload).some((value) => !value)) {
      setPartnerMessage("필수 항목을 모두 입력해주세요.", "error");
      return;
    }

    setPartnerMessage("");
    if (partnerButton) {
      partnerButton.disabled = true;
      partnerButton.textContent = "접수 중";
    }

    try {
      const response = await fetch("/api/agency-inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) {
        throw new Error(result.error?.message || result.message || "문의 접수에 실패했습니다.");
      }
      partnerForm.reset();
      setPartnerMessage("문의가 접수되었습니다. 담당자가 확인 후 연락드리겠습니다.", "success");
    } catch (error) {
      setPartnerMessage(error.message || "문의 접수에 실패했습니다. 잠시 후 다시 시도해주세요.", "error");
    } finally {
      if (partnerButton) {
        partnerButton.disabled = false;
        partnerButton.textContent = "제출하기";
      }
    }
  });
}
