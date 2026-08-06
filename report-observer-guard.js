'use strict';

/*
 * The agency report module used a document-wide MutationObserver and rewrote
 * button markup from inside that observer. On some browsers this produced a
 * self-triggering mutation loop that froze or terminated the app after a click.
 * Suppress only that one broad observer while the module is initialised.
 */
(function guardAgencyReportObserver(){
  if(window.__dlogisNativeMutationObserver||typeof window.MutationObserver!=='function')return;

  const NativeMutationObserver=window.MutationObserver;
  window.__dlogisNativeMutationObserver=NativeMutationObserver;

  window.MutationObserver=class DLogisStartupMutationObserver extends NativeMutationObserver{
    constructor(callback){
      super(callback);
      this.__dlogisCallback=callback;
      this.__dlogisSuppressed=false;
    }

    observe(target,options={}){
      const isDocumentWideButtonObserver=
        target===document.documentElement&&
        options.childList===true&&
        options.subtree===true&&
        options.attributes!==true&&
        options.characterData!==true;

      if(isDocumentWideButtonObserver){
        this.__dlogisSuppressed=true;
        return undefined;
      }

      return super.observe(target,options);
    }
  };
})();
