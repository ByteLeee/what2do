'use strict';
try { const theme = localStorage.getItem('what2do-theme'); if (['forest', 'ocean', 'apricot', 'lavender', 'night'].includes(theme)) document.documentElement.dataset.theme = theme; } catch { /* Settings snapshot remains authoritative. */ }
