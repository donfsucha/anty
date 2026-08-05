(()=>{
  const app=document.getElementById('app');
  if(!app||app.childElementCount)return;
  try{
    if(typeof render==='function')render();
  }catch(error){
    console.error('D-LOGIS 초기 화면 렌더링 실패',error);
    app.innerHTML='<main class="welcome"><div class="welcome-panel"><div class="notice warning"><strong>D-LOGIS 시작 화면을 불러오지 못했습니다.</strong><br>브라우저를 새로고침하거나 개발자 콘솔의 오류를 확인해 주세요.</div></div></main>';
  }
})();
