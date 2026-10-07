C7NTAX — Outlook add-in
========================

This package registered the C7NTAX "Create ticket" add-in with Outlook for the account that
ran it.

  Server          __ADDIN_HOST__
  Add-in id       __ADDIN_ID__
  Installed to    %LOCALAPPDATA%\C7NTAX\OutlookAddIn

Next step: restart Outlook. Office reads the add-in list once when it starts, so a running
Outlook will not show the button until it is closed and reopened. The C7NTAX group appears on
the ribbon of an open (or selected) message.

If the button does not appear
-----------------------------
1. Confirm Outlook is version 16.0 or later and is one of the desktop builds.
2. Check that __ADDIN_HOST__ is reachable from this computer in a browser. The taskpane and
   the ribbon icons are fetched from that server over HTTPS by Outlook itself, not by this
   package, so an unreachable server is an add-in that never loads.
3. In Outlook, open Get Add-ins, then My add-ins. The add-in should be listed there. Office
   reports a manifest it could not parse rather than hiding it.

Removing it
-----------
Settings, Apps, Installed apps, "C7NTAX Outlook add-in", Uninstall. That removes both the
copied manifest and the registration. Alternatively, from an elevated or normal prompt:

    msiexec /x "C7NTAX-OutlookAddIn.msi"

This package does not modify the mailbox and does not need administrator rights.
