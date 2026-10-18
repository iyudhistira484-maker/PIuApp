--!nocheck
-- A test double for the Studio API, written in Luau so public/plugins/PiwuStudio.luau
-- runs with real Luau semantics (operators, metatables, pcall) but no engine.
--
-- It mirrors documented Roblox behaviour for the pieces the plugin touches:
--   * CFrame.fromEulerAnglesXYZ / CFrame.Angles is RX·RY·RZ, per the CFrame docs
--     (`CFrame.fromEulerAngles(rx,0,0) * CFrame.fromEulerAngles(0,ry,0) * CFrame.fromEulerAngles(0,0,rz)`)
--   * CFrame.fromMatrix takes the COLUMNS of a rotation matrix (vX = RightVector,
--     vY = UpVector, vZ = third column)
--   * HttpService requires HttpEnabled like a place does
-- It is not the engine: a passing run here proves the plugin's own logic and
-- contracts, never that Studio behaves the same.
local Fake = {}
Fake.requests = {}
Fake.responses = {}
Fake.recordings = {}
Fake.clipboard = ""
Fake.spawned = {}
Fake.historyBusy = false
Fake.waits = 0
Fake.waited = 0
Fake.waitLimit = nil
Fake.loadAssetFails = {}
Fake.loadedAssets = {}

-- Minimal JSON so the plugin's own JSONEncode/JSONDecode have a real partner.
local function escape(text)
 local out = string.gsub(text, "[%c\"\\]", function(c)
  if c == '"' then return '\\"' end
  if c == "\\" then return "\\\\" end
  if c == "\n" then return "\\n" end
  if c == "\r" then return "\\r" end
  if c == "\t" then return "\\t" end
  return string.format("\\u%04x", string.byte(c))
 end)
 return out
end
local function encode(value)
 local kind = type(value)
 if kind == "nil" then return "null" end
 if kind == "boolean" then return value and "true" or "false" end
 if kind == "number" then
  if value ~= value or value == math.huge or value == -math.huge then return "null" end
  return tostring(value)
 end
 if kind == "string" then return '"' .. escape(value) .. '"' end
 if kind ~= "table" then return "null" end
 local count = #value
 if count > 0 then
  local parts = {}
  for index = 1, count do parts[index] = encode(value[index]) end
  return "[" .. table.concat(parts, ",") .. "]"
 end
 local keys = {}
 for key in pairs(value) do table.insert(keys, tostring(key)) end
 table.sort(keys)
 local parts = {}
 for _, key in ipairs(keys) do parts[#parts + 1] = '"' .. escape(key) .. '":' .. encode(value[key]) end
 return "{" .. table.concat(parts, ",") .. "}"
end
local function decode(text)
 local at = 1
 local function skip()
  while at <= #text do
   local byte = string.byte(text, at)
   if byte == 32 or byte == 9 or byte == 10 or byte == 13 then at += 1 else break end
  end
 end
 local parseValue
 local function parseString()
  at += 1
  local out = {}
  while at <= #text do
   local char = string.sub(text, at, at)
   if char == '"' then at += 1; return table.concat(out) end
   if char == "\\" then
    local nextChar = string.sub(text, at + 1, at + 1)
    if nextChar == "n" then table.insert(out, "\n")
    elseif nextChar == "t" then table.insert(out, "\t")
    elseif nextChar == "r" then table.insert(out, "\r")
    elseif nextChar == "u" then
     table.insert(out, string.char(tonumber(string.sub(text, at + 2, at + 5), 16) % 256))
     at += 4
    else table.insert(out, nextChar) end
    at += 2
   else
    table.insert(out, char); at += 1
   end
  end
  error("JSON tidak lengkap")
 end
 local function parseNumber()
  local start = at
  while at <= #text and string.find(string.sub(text, at, at), "[%d%.eE%+%-]") do at += 1 end
  return tonumber(string.sub(text, start, at - 1))
 end
 parseValue = function()
  skip()
  local char = string.sub(text, at, at)
  if char == "{" then
   at += 1
   local out = {}
   skip()
   if string.sub(text, at, at) == "}" then at += 1; return out end
   while true do
    skip()
    local key = parseString()
    skip(); at += 1 -- the colon
    out[key] = parseValue()
    skip()
    local sep = string.sub(text, at, at); at += 1
    if sep == "}" then return out end
   end
  elseif char == "[" then
   at += 1
   local out = {}
   skip()
   if string.sub(text, at, at) == "]" then at += 1; return out end
   while true do
    table.insert(out, parseValue())
    skip()
    local sep = string.sub(text, at, at); at += 1
    if sep == "]" then return out end
   end
  elseif char == '"' then
   return parseString()
  elseif char == "t" then at += 4; return true
  elseif char == "f" then at += 5; return false
  elseif char == "n" then at += 4; return nil
  end
  return parseNumber()
 end
 return parseValue()
end
Fake.encode = encode
Fake.decode = decode
Fake.json = function(value) return encode(value) end

-- Vector3 / Color3 / CFrame / UDim -------------------------------------------------
local Vector3 = {}
Vector3.__index = Vector3
function Vector3.new(x, y, z)
 return setmetatable({X = x or 0, Y = y or 0, Z = z or 0}, Vector3)
end
Vector3.zero = Vector3.new(0, 0, 0)
Vector3.__add = function(a, b) return Vector3.new(a.X + b.X, a.Y + b.Y, a.Z + b.Z) end
Vector3.__sub = function(a, b) return Vector3.new(a.X - b.X, a.Y - b.Y, a.Z - b.Z) end
function Vector3:Cross(other)
 return Vector3.new(self.Y * other.Z - self.Z * other.Y, self.Z * other.X - self.X * other.Z, self.X * other.Y - self.Y * other.X)
end
function Vector3:Unit()
 local length = math.sqrt(self.X * self.X + self.Y * self.Y + self.Z * self.Z)
 if length == 0 then return Vector3.new(0, 0, 0) end
 return Vector3.new(self.X / length, self.Y / length, self.Z / length)
end

local Color3 = {}
Color3.__index = Color3
function Color3.new(r, g, b) return setmetatable({R = r or 0, G = g or 0, B = b or 0}, Color3) end
Color3.fromRGB = function(r, g, b) return Color3.new((r or 0) / 255, (g or 0) / 255, (b or 0) / 255) end
Color3.fromHex = function(text)
 local hex = string.gsub(text, "#", "")
 return Color3.fromRGB(tonumber(string.sub(hex, 1, 2), 16) or 0, tonumber(string.sub(hex, 3, 4), 16) or 0, tonumber(string.sub(hex, 5, 6), 16) or 0)
end
function Color3:ToHex()
 local function part(value)
  local byte = math.floor(math.clamp(value, 0, 1) * 255 + 0.5)
  return string.format("%02X", byte)
 end
 return part(self.R) .. part(self.G) .. part(self.B)
end

local function matMul(a, b)
 local out = {}
 for row = 1, 3 do
  out[row] = {}
  for col = 1, 3 do
   out[row][col] = a[row][1] * b[1][col] + a[row][2] * b[2][col] + a[row][3] * b[3][col]
  end
 end
 return out
end
local function matApply(m, v)
 return Vector3.new(
  m[1][1] * v.X + m[1][2] * v.Y + m[1][3] * v.Z,
  m[2][1] * v.X + m[2][2] * v.Y + m[2][3] * v.Z,
  m[3][1] * v.X + m[3][2] * v.Y + m[3][3] * v.Z
 )
end
local CFrame = {}
CFrame.__index = CFrame
local function cframeFrom(position, matrix)
 return setmetatable({Position = position or Vector3.zero, Rotation = matrix or {{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}}, CFrame)
end
function CFrame.new(x, y, z)
 -- Roblox overloads this: CFrame.new(pos) with a Vector3, or three numbers.
 if type(x) == "table" and rawget(x, "X") then return cframeFrom(Vector3.new(x.X, x.Y, x.Z)) end
 return cframeFrom(Vector3.new(x, y, z))
end
-- Documented as fromEulerAngles(rx,0,0) * fromEulerAngles(0,ry,0) * fromEulerAngles(0,0,rz).
function CFrame.Angles(rx, ry, rz)
 local cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
 local x = {{1, 0, 0}, {0, cx, -sx}, {0, sx, cx}}
 local y = {{cy, 0, sy}, {0, 1, 0}, {-sy, 0, cy}}
 local z = {{cz, -sz, 0}, {sz, cz, 0}, {0, 0, 1}}
 return cframeFrom(Vector3.zero, matMul(matMul(x, y), z))
end
function CFrame.fromMatrix(position, vX, vY, vZ)
 local third = vZ or vX:Cross(vY):Unit()
 local matrix = {
  {vX.X, vY.X, third.X},
  {vX.Y, vY.Y, third.Y},
  {vX.Z, vY.Z, third.Z},
 }
 return cframeFrom(position, matrix)
end
local CF = {}
CF.__mul = function(a, b)
 local moved = matApply(a.Rotation, b.Position)
 return cframeFrom(Vector3.new(a.Position.X + moved.X, a.Position.Y + moved.Y, a.Position.Z + moved.Z), matMul(a.Rotation, b.Rotation))
end
CF.__index = CF
-- CFrame instances are metatabled to CFrame, so method lookup must land on CF.
CFrame.__index = CF
CFrame.__mul = CF.__mul
function CF:ToEulerAnglesXYZ()
 local m = self.Rotation
 local ry = math.asin(math.clamp(m[1][3], -1, 1))
 local cy = math.cos(ry)
 if math.abs(cy) < 1e-9 then
  -- Gimbal lock: the engine picks rx = 0 and folds the rest into rz.
  return 0, ry, math.atan2(m[2][1], m[1][1])
 end
 return math.atan2(-m[2][3], m[3][3]), ry, math.atan2(-m[1][2], m[1][1])
end
function CF:Inverse()
 local m = self.Rotation
 local inverse = {
  {m[1][1], m[2][1], m[3][1]},
  {m[1][2], m[2][2], m[3][2]},
  {m[1][3], m[2][3], m[3][3]},
 }
 local moved = matApply(inverse, self.Position)
 return cframeFrom(Vector3.new(-moved.X, -moved.Y, -moved.Z), inverse)
end
Fake.CFrame = CFrame
Fake.Vector3 = Vector3
Fake.Color3 = Color3

local UDim = {new = function(scale, offset) return {Scale = scale or 0, Offset = offset or 0} end}
local UDim2 = {
 new = function(xs, xo, ys, yo) return {X = UDim.new(xs, xo), Y = UDim.new(ys, yo)} end,
 fromScale = function(x, y) return {X = UDim.new(x, 0), Y = UDim.new(y, 0)} end,
}

-- Enum / signals ---------------------------------------------------------------------
local enumItems = {}
local Enum = setmetatable({}, {
 __index = function(_, typeName)
  local items = setmetatable({}, {
   __index = function(_, itemName)
    local key = typeName .. "." .. itemName
    if not enumItems[key] then enumItems[key] = {Name = itemName, EnumType = typeName} end
    return enumItems[key]
   end,
  })
  return items
 end,
})
local function signal()
 local handlers = {}
 return {
  Connect = function(_, fn) table.insert(handlers, fn); return {Disconnect = function() end} end,
  Fire = function(_, ...)
   for _, fn in ipairs(handlers) do fn(...) end
  end,
  Count = function() return #handlers end,
 }
end

-- Instances --------------------------------------------------------------------------
local Instances = {}
local instanceMeta = {}
local function attach(child, parent)
 -- rawget/rawset on purpose: Parent is served by __newindex, so writing
 -- child.Parent here would call attach again and overflow the stack.
 local previous = rawget(child, "Parent")
 if previous then
  local siblings = rawget(previous, "Children")
  for index, other in ipairs(siblings) do
   if other == child then table.remove(siblings, index); break end
  end
 end
 rawset(child, "Parent", parent)
 if parent then table.insert(rawget(parent, "Children"), child) end
end
local function scriptClass(className)
 return className == "Script" or className == "LocalScript" or className == "ModuleScript"
end
local classes = {
 Part = {["BasePart"] = true},
 Script = {["BaseScript"] = true},
 LocalScript = {["BaseScript"] = true},
 ModuleScript = {["BaseScript"] = true},
 Model = {},
 Folder = {},
}
local function newInstance(className)
 local self = {
  ClassName = className,
  Name = className,
  Children = {},
  Parent = nil,
  Properties = {},
  Attributes = {},
  Source = "",
  Destroyed = false,
 }
 table.insert(Instances, self)
 return setmetatable(self, instanceMeta)
end
instanceMeta.__index = function(self, key)
 if key == "Position" then
  local cframe = self.Properties.CFrame
  return cframe and cframe.Position or Vector3.new(0, 0, 0)
 end
 if key == "MouseButton1Click" or key == "Click" or key == "Unloading" then
  if not rawget(self, "__signal_" .. key) then rawset(self, "__signal_" .. key, signal()) end
  return rawget(self, "__signal_" .. key)
 end
 local methods = {
  IsA = function(_, want)
   if want == self.ClassName then return true end
   return (classes[self.ClassName] or {})[want] == true
  end,
  GetChildren = function() return table.clone(self.Children) end,
  GetDescendants = function()
   local out = {}
   for _, child in ipairs(self.Children) do
    table.insert(out, child)
    for _, deeper in ipairs(child:GetDescendants()) do table.insert(out, deeper) end
   end
   return out
  end,
  FindFirstChild = function(_, name) for _, child in ipairs(self.Children) do if child.Name == name then return child end end return nil end,
  SetAttribute = function(_, name, value)
   assert(not self.Destroyed, "Instance sudah dihapus")
   self.Attributes[name] = value
  end,
  GetAttribute = function(_, name) return self.Attributes[name] end,
  Destroy = function()
   attach(self, nil)
   self.Destroyed = true
  end,
  GetPivot = function() return self.Properties.Pivot or CFrame.new() end,
  PivotTo = function(_, cframe)
   -- Roblox moves the model AND its descendants: a part placed before its
   -- model's pivot would otherwise end up in the wrong place, which is exactly
   -- the bug this double is here to catch.
   local previous = self.Properties.Pivot or CFrame.new()
   self.Properties.Pivot = cframe
   self.Properties.PivotCalls = (self.Properties.PivotCalls or 0) + 1
   local delta = cframe * previous:Inverse()
   for _, child in ipairs(self:GetDescendants()) do
    if child.Properties.CFrame then child.Properties.CFrame = delta * child.Properties.CFrame end
   end
  end,
 }
 if methods[key] then return methods[key] end
 return self.Properties[key]
end
instanceMeta.__newindex = function(self, key, value)
 -- Roblox rejects `instance.Property = nil`; catching it here turns a class of
 -- real plugin bug into a failed test instead of a silent no-op.
 if value == nil then error("Instance." .. tostring(key) .. " tidak menerima nil") end
 if key == "Parent" then
  attach(self, value)
  return
 end
 if key == "Source" then
  rawset(self, "Source", value)
  return
 end
 self.Properties[key] = value
end
local Instance = {new = function(className) return newInstance(className) end}

-- Services ---------------------------------------------------------------------------
local services = {}
local function service(name)
 if not services[name] then
  local instance = newInstance(name)
  instance.Name = name
  services[name] = instance
 end
 return services[name]
end
local HttpService = service("HttpService")
HttpService.HttpEnabled = true
HttpService.JSONEncode = function(_, value) return encode(value) end
HttpService.JSONDecode = function(_, text) return decode(text) end
local guidCount = 0
HttpService.GenerateGUID = function()
 -- A counter, not the instance count: the plugin asks for ids long after every
 -- instance already exists, so a count-based id would repeat. The shape is a
 -- UUID, like HttpService:GenerateGUID on Roblox, because the server schema
 -- accepts only UUIDs for snapshotId.
 guidCount += 1
 return string.format("%08x-0000-4000-8000-%012x", guidCount, guidCount)
end
HttpService.RequestAsync = function(_, request)
 -- A refused request is still an attempt: the plugin must not silently retry.
 table.insert(Fake.requests, {Method = request.Method, Url = request.Url, Body = request.Body or ""})
 if Fake.httpError then error(Fake.httpError) end
 local path = string.match(request.Url, "/api/studio/([%w%?%%=_%-%.]+)") or "?"
 local canned = Fake.responses[path]
 if not canned then
  return {Success = false, StatusCode = 503, Body = '{"error":"harness: belum ada balasan palsu untuk ' .. path .. '"}'}
 end
 return {Success = canned.ok ~= false, StatusCode = canned.status or 200, Body = canned.body or "{}"}
end
local History = service("ChangeHistoryService")
History.TryBeginRecording = function(_, id, label)
 if Fake.historyBusy then return nil end
 local recording = {Id = id, Label = label or "", Operations = {}}
 table.insert(Fake.recordings, recording)
 return recording
end
History.FinishRecording = function(_, recording, operation)
 table.insert(recording.Operations, operation and operation.Name or "?")
 recording.Finished = true
end
local ScriptEditor = service("ScriptEditorService")
ScriptEditor.GetEditorSource = function(_, instance)
 assert(not instance.Properties.Unreadable, "source tidak bisa dibaca")
 return instance.Source or ""
end
ScriptEditor.UpdateSourceAsync = function(_, instance, resolve)
 local text = resolve()
 instance.Source = text
 instance.Properties.SourceUpdates = (instance.Properties.SourceUpdates or 0) + 1
end
local RunService = service("RunService")
RunService.IsRunning = function() return Fake.running == true end
local InsertService = service("InsertService")
InsertService.LoadAsset = function(_, assetId)
 if Fake.loadAssetFails[assetId] then error("asset tidak bisa dimuat") end
 table.insert(Fake.loadedAssets, assetId)
 local model = newInstance("Model")
 model.Name = "Asset"
 model.Properties.AssetId = assetId
 return model
end
local Selection = service("Selection")
Selection._selected = {}
Selection.Get = function() return Selection._selected end
local game = {
 PlaceId = Fake.placeId or 7654321,
 GetService = function(_, name) return service(name) end,
}
game.Workspace = service("Workspace")
local plugin = {
 -- Plugin.Unloading is a plain signal on the Plugin instance, like in Studio.
 Unloading = signal(),
 CreateToolbar = function()
  return {CreateButton = function(_, text, tooltip, icon)
   local button = newInstance("TextButton")
   button.Text = text or ""
   button.Properties.Active = false
   -- PluginToolbarButton:SetActive keeps the button lit; that is the only
   -- Studio-side hint that a bundle is waiting.
   button.SetActive = function(_, value) button.Active = value == true end
   Fake.toggle = button
   return button
  end}
 end,
 -- Documented as Plugin:CreateDockWidgetPluginGui(pluginGuiId, info).
 CreateDockWidgetPluginGui = function(_, info)
  assert(info ~= nil, "DockWidgetPluginGuiInfo wajib")
  local widget = newInstance("DockWidgetPluginGui")
  widget.Enabled = true
  Fake.widget = widget
  return widget
 end,
}
local task = {
 -- Returns at once; Fake.waitLimit lets a test stop a `while true` loop after
 -- one pass instead of spinning.
 wait = function(seconds)
  Fake.waits += 1
  Fake.waited += seconds or 0
  if Fake.waitLimit and Fake.waits > Fake.waitLimit then error("harness: batas tunggu tercapai") end
  return 0
 end,
 spawn = function(fn) table.insert(Fake.spawned, fn) end,
 defer = function(fn) table.insert(Fake.spawned, fn) end,
}
local function noop() end
local env = {
 Instance = Instance,
 Enum = Enum,
 Vector3 = Vector3,
 CFrame = CFrame,
 Color3 = Color3,
 UDim = UDim,
 UDim2 = UDim2,
 game = game,
 workspace = game.Workspace,
 plugin = plugin,
 task = task,
 DockWidgetPluginGuiInfo = {new = function() return {} end},
 setclipboard = function(text) Fake.clipboard = text end,
 warn = noop,
 print = noop,
 _PIWU_TEST = true,
}
-- The harness never writes globals: `_G` is readonly in the sandbox, and the
-- plugin is loaded as a function that takes this table as parameters. That also
-- makes the API surface the plugin needs explicit.
env.fake = Fake
Fake.env = env
Fake.Instance = Instance
Fake.service = service
Fake.signal = signal
Fake.game = game
Fake.plugin = plugin
Fake.newInstance = newInstance

-- Harness entry points (all JSON in / JSON out so the Node side has no interop
-- surprises with Luau tables). ------------------------------------------------------
Fake.setResponses = function(json) Fake.responses = decode(json) end
Fake.loadTree = function(json)
 for _, entry in ipairs(decode(json)) do
  local serviceInstance = service(entry.service)
  local parent = serviceInstance
  local names = {}
  for name in string.gmatch(entry.path or "", "[^/]+") do table.insert(names, name) end
  local leaf = table.remove(names)
  for _, name in ipairs(names) do
   local nextParent = parent:FindFirstChild(name)
   if not nextParent then
    nextParent = newInstance("Folder")
    nextParent.Name = name
    nextParent.Parent = parent
   end
   parent = nextParent
  end
  local instance = newInstance(entry.class)
  instance.Name = leaf or entry.class
  local props = entry.props or {}
  if entry.class == "Part" then
   local position = props.position or {0, 0, 0}
   local rotation = props.rotation or {0, 0, 0}
   instance.Properties.CFrame = CFrame.new(position[1], position[2], position[3]) * CFrame.Angles(math.rad(rotation[1]), math.rad(rotation[2]), math.rad(rotation[3]))
   instance.Properties.Size = Vector3.new((props.size or {1, 1, 1})[1], (props.size or {1, 1, 1})[2], (props.size or {1, 1, 1})[3])
   instance.Properties.Color = Color3.fromHex(props.color or "#ffffff")
   instance.Properties.Anchored = props.anchored ~= false
   instance.Properties.Shape = Enum.PartType[props.shape or "Block"]
  end
  if entry.class == "Model" and props.pivot then
   instance.Properties.Pivot = CFrame.new(props.pivot[1], props.pivot[2], props.pivot[3])
  end
  if props.source then instance.Source = props.source end
  if props.unreadable then instance.Properties.Unreadable = true end
  if props.piwuId then instance.Attributes.PiwuBridgeId = props.piwuId end
  instance.Parent = parent
 end
 return "ok"
end
-- Runs everything the plugin handed to task.spawn/defer, letting task.wait
-- succeed `limit` times; the loop then errors out of the harness on purpose.
Fake.runSpawned = function(limit, responsesJson)
 if responsesJson then Fake.setResponses(responsesJson) end
 Fake.waits = 0
 Fake.waited = 0
 Fake.waitLimit = limit or 1
 local first = table.remove(Fake.spawned, 1)
 if not first then Fake.waitLimit = nil; return "tidak ada task" end
 local ok, err = pcall(first)
 Fake.waitLimit = nil
 if ok or string.find(tostring(err), "batas tunggu tercapai", 1, true) then return "ok" end
 return tostring(err)
end
Fake.setPlaceId = function(id) game.PlaceId = id end
Fake.setHttpEnabled = function(value) HttpService.HttpEnabled = value end
-- "" clears it again, so one scenario can recover after a refusal.
Fake.setHttpError = function(message) Fake.httpError = (message ~= "" and message) or nil end
Fake.setRunning = function(value) Fake.running = value end
Fake.setHistoryBusy = function(value) Fake.historyBusy = value end
Fake.setLoadAssetFails = function(json) Fake.loadAssetFails = decode(json) end
Fake.requestsCount = function() return #Fake.requests end
Fake.recordingsCount = function() return #Fake.recordings end
Fake.instanceCount = function()
 local total = 0
 for name in pairs(services) do total += #service(name):GetDescendants() end
 return total
end
Fake.requestsJson = function() return #Fake.requests > 0 and encode(Fake.requests) or "[]" end
Fake.recordingsJson = function() return #Fake.recordings > 0 and encode(Fake.recordings) or "[]" end
Fake.loadedAssetsJson = function() return #Fake.loadedAssets > 0 and encode(Fake.loadedAssets) or "[]" end
Fake.clipboardText = function() return Fake.clipboard end
Fake.statusText = function() return Fake.internals.ui.status.Text end
Fake.reviewText = function() return Fake.internals.ui.review.Text end
Fake.httpNoteVisible = function() return Fake.internals.ui.httpNote.Visible == true end
Fake.widgetTitle = function() return Fake.widget and Fake.widget.Title or "" end
Fake.toggleActive = function() return Fake.toggle ~= nil and Fake.toggle.Active == true end
Fake.click = function(name, times)
 local button = Fake.internals.ui.buttons[name] or Fake.internals.ui[name]
 assert(button and button.MouseButton1Click, "harness: elemen UI tidak dikenal: " .. tostring(name))
 for _ = 1, (times or 1) do button.MouseButton1Click:Fire() end
 return Fake.statusText()
end
Fake.connect = function(url, token)
 Fake.internals.connect(url, token)
 return "ok"
end
Fake.version = function() return Fake.internals.version end
Fake.limitsJson = function() return encode(Fake.internals.limits) end
Fake.selectFolder = function(path)
 local node = Fake.find(path)
 Selection._selected = node and {node} or {}
 return node and node.Name or ""
end
local function pathOf(instance)
 local parts = {}
 local current = instance
 while current and current.Parent do
  table.insert(parts, 1, current.Name)
  current = current.Parent
 end
 return table.concat(parts, "/")
end
Fake.find = function(path)
 local current = game.Workspace
 local serviceName, rest = string.match(path, "^services/([^/]+)/(.*)$")
 if serviceName then current = service(serviceName) else rest = string.gsub(path, "^workspace/", "") end
 for name in string.gmatch(rest, "[^/]+") do
  local nextChild = current:FindFirstChild(name)
  if not nextChild then return nil end
  current = nextChild
 end
 return current
end
-- A JSON dump of the place the plugin produced, with the numbers a reviewer
-- needs to check placement, colour and rotation.
Fake.treeJson = function()
 local function cframeJson(cframe)
  if not cframe then return nil end
  local flat = {}
  for row = 1, 3 do for col = 1, 3 do table.insert(flat, cframe.Rotation[row][col]) end end
  return {position = {cframe.Position.X, cframe.Position.Y, cframe.Position.Z}, matrix = flat}
 end
 local function dump(instance)
  local out = {
   class = instance.ClassName,
   name = instance.Name,
   path = pathOf(instance),
   attributes = instance.Attributes,
   size = instance.Properties.Size and {instance.Properties.Size.X, instance.Properties.Size.Y, instance.Properties.Size.Z} or nil,
   color = instance.Properties.Color and ("#" .. instance.Properties.Color:ToHex()) or nil,
   anchored = instance.Properties.Anchored,
   shape = instance.Properties.Shape and instance.Properties.Shape.Name or nil,
   cframe = cframeJson(instance.Properties.CFrame),
   pivot = cframeJson(instance.Properties.Pivot),
   assetId = instance.Properties.AssetId,
   disabled = instance.Properties.Disabled,
  }
  if scriptClass(instance.ClassName) then out.source = instance.Source end
  out.children = {}
  for _, child in ipairs(instance.Children) do table.insert(out.children, dump(child)) end
  return out
 end
 local servicesDump = {}
 for name in pairs(services) do
  if #service(name):GetChildren() > 0 then table.insert(servicesDump, dump(service(name))) end
 end
 -- Stable order so assertions do not depend on table iteration order.
 table.sort(servicesDump, function(a, b) return a.path < b.path end)
 return encode(servicesDump)
end
Fake.snapshotJson = function(snapshotId, assign)
 local data = Fake.internals.snapshot(snapshotId, assign == true)
 return encode(data)
end
Fake.sceneCheckJson = function(sceneJson)
 local ok, result = pcall(function() return Fake.internals.checkScene(decode(sceneJson)) end)
 if not ok then return encode({ok = false, error = tostring(result)}) end
 return encode({ok = true})
end
Fake.buildSceneJson = function(sceneJson, assetsJson, optionsJson)
 local scene = decode(sceneJson)
 local assets = decode(assetsJson or "{}")
 local options = decode(optionsJson or "{}")
 local group
 if options.inSelection then
  group = Selection:Get()[1]
 else
  group = newInstance("Folder")
  group.Name = "PiwuScene"
  group.Parent = game.Workspace
 end
 local rootWorld = options.rootWorld and CFrame.new(options.rootWorld[1], options.rootWorld[2], options.rootWorld[3]) or CFrame.new()
 local ok, report = pcall(function() return Fake.internals.buildScene(scene, assets, {group = group, rootWorld = rootWorld}) end)
 if not ok then return encode({ok = false, error = tostring(report)}) end
 report.ok = true
 return encode(report)
end
Fake.applyBundleFlowJson = function(bundleJson, snapshotId)
 local bundle = decode(bundleJson)
 local current, map = Fake.internals.snapshot(snapshotId, false)
 local _, mapKnown = Fake.internals.snapshot(snapshotId, false)
 local validated, validateError = pcall(function() return Fake.internals.validate(bundle, mapKnown) end)
 if not validated then return encode({ok = false, stage = "validate", error = tostring(validateError)}) end
 local result = Fake.internals.applyBundle(bundle, current, map)
 result.stage = "apply"
 return encode(result)
end
