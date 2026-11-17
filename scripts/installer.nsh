!macro customInstall
  WriteRegStr SHCTX "Software\Classes\share-local" "" "URL:Share Local"
  WriteRegStr SHCTX "Software\Classes\share-local" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\share-local\DefaultIcon" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr SHCTX "Software\Classes\share-local\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" -- "%1"'
!macroend

!macro customUnInstall
  ReadRegStr $R0 SHCTX "Software\Classes\share-local\shell\open\command" ""
  ${If} $R0 == '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" -- "%1"'
    DeleteRegKey SHCTX "Software\Classes\share-local"
  ${EndIf}
!macroend
