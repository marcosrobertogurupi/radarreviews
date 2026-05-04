(function() {
  const container = document.getElementById('reputei-widget');
  if (!container) return;

  const token = container.getAttribute('data-token');
  if (!token) return;

  const API_BASE = 'https://api-production-24e1.up.railway.app'; // Ajustar para produção se necessário

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
      .reputei-card { background: ${isDark ? '#1f2937' : '#ffffff'}; border: 1px solid ${isDark ? '#374151' : '#e5e7eb'}; border-radius: 12px; padding: 20px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); margin-bottom: 16px; }
      .reputei-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; border-bottom: 1px solid ${isDark ? '#374151' : '#f3f4f6'}; padding-bottom: 12px; }
      .reputei-title { font-weight: 700; color: ${isDark ? '#f9fafb' : '#111827'}; font-size: 16px; }
      .reputei-review { margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid ${isDark ? '#374151' : '#f3f4f6'}; }
      .reputei-review:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
      .reputei-author { font-weight: 600; font-size: 14px; color: ${isDark ? '#f3f4fb' : '#374151'}; margin-bottom: 4px; }
      .reputei-stars { color: #f59e0b; font-size: 12px; margin-bottom: 6px; }
      .reputei-body { font-size: 13.5px; color: ${isDark ? '#9ca3af' : '#4b5563'}; line-height: 1.6; font-style: italic; }
      .reputei-footer { font-size: 11px; color: #9ca3af; text-align: center; margin-top: 10px; }
      .reputei-footer a { color: #6366f1; text-decoration: none; font-weight: 600; }
    `;

    const styleTag = document.createElement('style');
    styleTag.innerHTML = styles;
    document.head.appendChild(styleTag);

    let reviewsHtml = '';
    data.reviews.forEach(r => {
      const stars = '★'.repeat(r.rating || 5) + '☆'.repeat(5 - (r.rating || 5));
      reviewsHtml += `
        <div class="reputei-review">
          <div class="reputei-author">${r.author_name || 'Cliente'}</div>
          <div class="reputei-stars">${stars}</div>
          <div class="reputei-body">"${r.body || 'Feedback positivo!'}"</div>
        </div>
      `;
    });

    container.innerHTML = `
      <div class="reputei-card">
        <div class="reputei-header">
          <div class="reputei-title">O que dizem sobre ${data.business_name}</div>
          <div style="font-size: 12px; color: #10b981; font-weight: 700;">✓ Verificado</div>
        </div>
        <div class="reputei-reviews-list">
          ${reviewsHtml || '<p style="font-size: 13px; color: #9ca3af; text-align: center;">Carregando ótimas experiências...</p>'}
        </div>
        <div class="reputei-footer">
          Monitorado por <a href="https://reputei.com.br" target="_blank">Reputei</a>
        </div>
      </div>
    `;
  }

  init();
})();
