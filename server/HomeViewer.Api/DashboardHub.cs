using Microsoft.AspNetCore.SignalR;

namespace HomeViewer.Api;

// Server-to-client only: the server pushes "SettingsUpdated" when settings change.
public class DashboardHub : Hub;
