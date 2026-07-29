(function() {
  const container = document.getElementById('reputei-widget');
  if (!container) return;

  const token = container.getAttribute('data-token');
  if (!token) return;

  let API_BASE = 'https://api.reputei.com.br';
  let scriptEl = document.currentScript || document.querySelector('script[src*="widget.js"]');
  if (scriptEl && scriptEl.src) {
    try {
      const url = new URL(scriptEl.src);
      API_BASE = url.origin;
    } catch(e) {}
  }

  async function init() {
    try {
      const res = await fetch(`${API_BASE}/api/widget/${token}`);
      const data = await res.json();
      
      if (data.error) throw new Error(data.error);

      render(data);
    } catch (err) {
      console.error('[Reputei Widget] Erro ao carregar:', err);
    }
  }

  function render(data) {
    const config = data.config || {};
    const theme = config.theme || 'light';
    const isDark = theme === 'dark';

    const styles = `
      #reputei-widget { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 600px; margin: 0 auto; }
      .reputei-card { background: ${isDark ? '#1f2937' : '#ffffff'}; border: 1px solid ${isDark ? '#374151' : '#e5e7eb'}; border-radius: 14px; padding: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
      .reputei-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; border-bottom: 1px solid ${isDark ? '#374151' : '#f3f4f6'}; padding-bottom: 12px; }
      .reputei-title { font-weight: 700; color: ${isDark ? '#f9fafb' : '#111827'}; font-size: 15px; }
      .reputei-review { margin-bottom: 14px; padding-bottom: 14px; border-bottom: 1px solid ${isDark ? '#374151' : '#f3f4f6'}; }
      .reputei-review:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
      .reputei-author-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
      .reputei-author { font-weight: 600; font-size: 13.5px; color: ${isDark ? '#f3f4fb' : '#374151'}; }
      .reputei-stars { color: #f59e0b; font-size: 13px; letter-spacing: 1px; }
      .reputei-body { font-size: 13px; color: ${isDark ? '#9ca3af' : '#4b5563'}; line-height: 1.5; font-style: italic; margin-top: 4px; }
      .reputei-footer { font-size: 11px; color: #9ca3af; text-align: center; margin-top: 14px; padding-top: 10px; border-top: 1px dashed ${isDark ? '#374151' : '#e5e7eb'}; }
      .reputei-footer a { color: #6366f1; text-decoration: none; font-weight: 600; }
    `;

    const styleTag = document.createElement('style');
    styleTag.innerHTML = styles;
    document.head.appendChild(styleTag);

    let reviewsHtml = '';
    const reviewsList = data.reviews || [];

    reviewsList.forEach(r => {
      const stars = '★'.repeat(r.rating || 5) + '☆'.repeat(5 - (r.rating || 5));
      const channelLabel = r.channel ? `<span style="font-size: 10px; opacity: 0.7; padding: 2px 6px; background: ${isDark ? 'rgba(255,255,255,0.1)' : '#f1f5f9'}; borderRadius: 4px;">${r.channel}</span>` : '';
      reviewsHtml += `
        <div class="reputei-review">
          <div class="reputei-author-row">
            <div class="reputei-author">${r.author_name || 'Cliente'}</div>
            ${channelLabel}
          </div>
          <div class="reputei-stars">${stars}</div>
          <div class="reputei-body">"${r.body || 'Excelente atendimento e qualidade!'}"</div>
        </div>
      `;
    });

    container.innerHTML = `
      <div class="reputei-card">
        <div class="reputei-header">
          <div class="reputei-title">O que dizem sobre ${data.business_name}</div>
          <div style="font-size: 12px; color: #10b981; font-weight: 700; display: flex; align-items: center; gap: 4px;">✓ Selo Verificado</div>
        </div>
        <div class="reputei-reviews-list">
          ${reviewsHtml || '<p style="font-size: 13px; color: #9ca3af; text-align: center;">Nenhuma avaliação recente disponível no momento.</p>'}
        </div>
        <div class="reputei-footer">
          Monitorado por <a href="https://reputei.com.br" target="_blank" rel="noopener">Reputei</a>
        </div>
      </div>
    `;
  }

  init();
})();
