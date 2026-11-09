param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$Target)
$ErrorActionPreference='Stop'
$word=$null
$document=$null
try {
  $word=New-Object -ComObject Word.Application
  $word.Visible=$false
  $word.DisplayAlerts=0
  $word.AutomationSecurity=3
  $word.Options.UpdateLinksAtOpen=$false
  $document=$word.Documents.Open($Source,$false,$true,$false)
  $document.SaveAs2($Target,16)
} finally {
  if($document){$document.Close(0);[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document)}
  if($word){$word.Quit(0);[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word)}
}
