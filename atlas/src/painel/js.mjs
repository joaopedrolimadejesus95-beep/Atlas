// JS do painel (idêntico ao original): expandir card + filtrar.
export const PAINEL_JS = [

  "document.getElementById('list').addEventListener('click',function(e){",
  "  var row=e.target.closest('.row'); if(!row) return;",
  "  var card=row.closest('.card'); var ab=card.classList.toggle('open');",
  "  row.setAttribute('aria-expanded', ab?'true':'false');",
  "});",
  "document.querySelector('.filters').addEventListener('click',function(e){",
  "  var chip=e.target.closest('.chip'); if(!chip) return;",
  "  document.getElementById('list').setAttribute('data-filtro', chip.dataset.f);",
  "  var chips=document.querySelectorAll('.chip');",
  "  for(var i=0;i<chips.length;i++){ chips[i].setAttribute('aria-pressed', chips[i]===chip?'true':'false'); }",
  "});",
].join("\n");
