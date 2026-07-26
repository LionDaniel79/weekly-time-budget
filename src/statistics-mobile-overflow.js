function injectMobileOverflowFix() {
  if (document.querySelector('#statistics-mobile-overflow-styles')) return;

  const style = document.createElement('style');
  style.id = 'statistics-mobile-overflow-styles';
  style.textContent = `
    @media(max-width:800px){
      .statistics-card{min-width:0;max-width:100%;overflow:hidden;box-sizing:border-box}
      .comparison-list{min-width:0;max-width:100%}
      .comparison-row{min-width:0;max-width:100%;box-sizing:border-box}
      .comparison-bars{min-width:0;max-width:100%}
      .comparison-bar-line{min-width:0;max-width:100%;grid-template-columns:42px minmax(0,1fr)}
      .comparison-values{min-width:0;max-width:100%;overflow-wrap:anywhere;word-break:break-word}
      .statistics-table-wrap{overflow-x:hidden!important;width:100%;max-width:100%;min-width:0;box-sizing:border-box}
      .statistics-table{display:block;width:100%;min-width:0;max-width:100%;box-sizing:border-box}
      .statistics-table tbody{display:grid;width:100%;min-width:0;max-width:100%;box-sizing:border-box}
      .statistics-table tr{display:grid;width:100%;min-width:0;max-width:100%;box-sizing:border-box}
      .statistics-table td,.statistics-table td:first-child{min-width:0;max-width:100%;overflow-wrap:anywhere;word-break:break-word;box-sizing:border-box}
      .statistics-table td::before{min-width:0;overflow-wrap:anywhere;word-break:break-word}
      .matrix-cell{min-width:0;max-width:100%;overflow:hidden}
      .matrix-cell strong{min-width:0;max-width:100%;overflow-wrap:anywhere;word-break:break-word}
      .matrix-cell small{min-width:0;max-width:100%;overflow-wrap:anywhere;word-break:break-word}
    }
  `;
  document.head.append(style);
}

injectMobileOverflowFix();
