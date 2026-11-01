using Microsoft.AspNetCore.SignalR;

namespace HomeViewer.Api;

// Server-to-client only: the server pushes "SettingsUpdated" and "ShoppingUpdated" when they change.
public class DashboardHub : Hub;
