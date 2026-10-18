--!strict
-- PiwuApp Studio Bridge v2.2.0. Install as a LOCAL plugin; never as a game Script.
-- HTTP goes only to the HTTPS origin you enter, under Studio's plugin permission
-- prompt (View > Plugin Management). Tokens stay in memory for 30 minutes.
-- Does not run imported code, require modules, publish games, or use loadstring.
--
-- What it does: sends a snapshot of the place for review in PiwuApp, applies the
-- reviewed bundle (with Undo support), and builds the project's scene.roblox.json
-- in Studio so a model made from a photo lands as real Part/Model instances.
local VERSION = "2.2.0"
local Http = game:GetService("HttpService")
local History = game:GetService("ChangeHistoryService")
local Scripts = game:GetService("ScriptEditorService")
local Run = game:GetService("RunService")
local Insert = game:GetService("InsertService")
local Selection = game:GetService("Selection")
local toolbar = plugin:CreateToolbar("PiwuApp")
local toggle = toolbar:CreateButton("PiwuApp Bridge", "Hubungkan project PiwuApp", "")
local widget = plugin:CreateDockWidgetPluginGui("PiwuAppStudioBridgeV1", DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Right, false, false, 440, 660, 330, 420))
widget.Title = "PiwuApp · Studio Bridge v" .. VERSION
-- Roblox gives a plugin no push channel: the only signal a user gets without
-- opening the panel is the toolbar button lighting up plus this title. It is a
-- hint, never a change — nothing is applied until the user clicks through.
local function setWaiting(waiting)
 if type(toggle.SetActive) == "function" then pcall(toggle.SetActive, toggle, waiting == true) end
 widget.Title = "PiwuApp · Studio Bridge v" .. VERSION .. (waiting and " · perubahan menunggu" or "")
end
setWaiting(false)
local frame = Instance.new("ScrollingFrame")
frame.Size = UDim2.fromScale(1, 1)
frame.BackgroundColor3 = Color3.fromRGB(27, 34, 39)
frame.BorderSizePixel = 0
frame.AutomaticCanvasSize = Enum.AutomaticSize.Y
frame.CanvasSize = UDim2.new()
frame.ScrollBarThickness = 6
frame.Parent = widget
local padding = Instance.new("UIPadding")
padding.PaddingLeft = UDim.new(0, 14); padding.PaddingRight = UDim.new(0, 14)
padding.PaddingTop = UDim.new(0, 12); padding.PaddingBottom = UDim.new(0, 12); padding.Parent = frame
local layout = Instance.new("UIListLayout")
layout.Padding = UDim.new(0, 10); layout.SortOrder = Enum.SortOrder.LayoutOrder; layout.Parent = frame
local order = 0
local function element(className, text, height)
 order += 1
 local e = Instance.new(className)
 e.LayoutOrder = order; e.Size = UDim2.new(1, -4, 0, height)
 e.BackgroundColor3 = Color3.fromRGB(42, 55, 62); e.BorderSizePixel = 0
 e.TextColor3 = Color3.fromRGB(221, 235, 237); e.Font = Enum.Font.SourceSans; e.TextSize = 16
 e.TextWrapped = true; e.Text = text; e.Parent = frame
 return e
end
local note = element("TextLabel", "EDIT MODE · Default: tidak ada perubahan otomatis. Opsi Sinkron langsung menerapkan bundle yang sudah Anda kirim dari PiwuApp dalam ~5 detik. Simpan salinan place sebelum menerapkan.", 92)
local httpNote = element("TextLabel", "", 0)
httpNote.TextXAlignment = Enum.TextXAlignment.Left; httpNote.Visible = false
-- Grows with its own text: the old fixed height of 0 made the help invisible.
httpNote.AutomaticSize = Enum.AutomaticSize.Y
local copyHttpButton = element("TextButton", "Salin baris Command Bar (jalan terakhir)", 36)
copyHttpButton.Visible = false
local origin = element("TextBox", "", 40)
origin.PlaceholderText = "https://alamat-piwuapp-anda"; origin.ClearTextOnFocus = false
local tokenInput = element("TextBox", "", 40)
tokenInput.PlaceholderText = "Token pasangan (30 menit, bukan API key Supabase)"; tokenInput.ClearTextOnFocus = false
local connectButton = element("TextButton", "Simpan koneksi di memori", 40)
local checkButton = element("TextButton", "Tes koneksi & lihat status project", 36)
local sendButton = element("TextButton", "1 · Kirim snapshot ke PiwuApp", 40)
local fetchButton = element("TextButton", "2 · Ambil & tinjau perubahan", 40)
local applyButton = element("TextButton", "3 · Terapkan bundle yang ditinjau", 40)
local sceneButton = element("TextButton", "Impor scene project (Part/Model) ke Studio", 40)
local sceneApplyButton = element("TextButton", "Bangun scene hasil tinjauan", 40)
local sceneReplace = element("TextButton", "Ganti folder PiwuScene yang sudah ada: YA", 34)
local sceneInSelection = element("TextButton", "Pakai objek terpilih sebagai induk: TIDAK", 34)
local autoPoll = element("TextButton", "Periksa antrean otomatis tiap 20 detik: YA (hanya memberi tahu)", 34)
local liveSync = element("TextButton", "Sinkron langsung PiwuApp → Studio: TIDAK", 34)
local clearButton = element("TextButton", "Putuskan & hapus token lokal", 36)
local status = element("TextLabel", "Belum terhubung. Versi plugin " .. VERSION .. ".", 88)
status.TextYAlignment = Enum.TextYAlignment.Top
local review = element("TextBox", "Ringkasan perubahan akan muncul di sini. Baca source script di PiwuApp sebelum mengirim bundle.", 250)
review.MultiLine = true; review.ClearTextOnFocus = false; review.TextEditable = false
review.TextXAlignment = Enum.TextXAlignment.Left; review.TextYAlignment = Enum.TextYAlignment.Top
local address, credential = "", ""
local busy = false
local baseline = nil
local pending = nil
local applied = {}
local confirmUntil = 0
local scenePlan = nil
local sceneConfirmUntil = 0
local replaceScene, inSelection, pollEnabled = true, false, true
local liveEnabled = false
-- User-editable services, NOT CoreGui/CorePackages/engine internals.
local roots = {"Workspace", "ReplicatedFirst", "ReplicatedStorage", "ServerScriptService", "ServerStorage", "StarterGui", "StarterPack", "StarterPlayer", "Lighting", "SoundService", "Teams", "TextChatService", "MaterialService", "LocalizationService"}
local editable = {Folder=true, Model=true, Part=true, Script=true, LocalScript=true, ModuleScript=true}
local scriptClasses = {Script=true, LocalScript=true, ModuleScript=true}
local LIMITS = {nodes=750, scripts=140, sourceBytes=100000, snapshotBytes=4000000, changes=300, sceneObjects=250}
local SCENE_FOLDER = "PiwuScene"
local HTTP_COMMAND = 'game:GetService("HttpService").HttpEnabled = true'
local function clean(s)
 local text = string.gsub(s, "[^%w_-]", "_")
 return string.sub(text, 1, 35)
end
local function array(v) return {v.X,v.Y,v.Z} end
local function isScript(o) return scriptClasses[o.ClassName] == true end
local function say(text) status.Text = text end
local function liveLabel()
 liveSync.Text = "Sinkron langsung PiwuApp → Studio: " .. (liveEnabled and "YA · terapkan dalam ~5 detik" or "TIDAK")
end
-- A Studio plugin asks for its OWN network permission: the first request to a new
-- address shows an Allow/Deny prompt, and access can be revoked later in
-- View → Plugin Management. The place's "Allow HTTP Requests" setting governs
-- in-game scripts, so it is NOT the first thing to check here; it is only offered
-- as a last resort when a machine refuses plugin requests anyway. The plugin never
-- writes HttpEnabled itself — that switch belongs to the user.
local function placeHttpEnabled()
 local ok, value = pcall(function() return Http.HttpEnabled end)
 return ok and value == true
end
local function pluginPermissionProblem(message)
 local text = string.lower(message)
 if string.find(text, "httpenabled", 1, true) or string.find(text, "not enabled", 1, true) then return true end
 if not string.find(text, "http", 1, true) then return false end
 for _, word in {"not allowed", "permission", "denied", "forbidden"} do
  if string.find(text, word, 1, true) then return true end
 end
 return false
end
local function showHttpHelp(detail)
 local place = placeHttpEnabled()
 httpNote.Text = "Studio belum mengizinkan permintaan HTTP untuk plugin ini" .. (detail ~= "" and (" — " .. detail) or "") .. ".\n" ..
  "1. Coba lagi; Studio biasanya menampilkan pertanyaan izin untuk alamat " .. (address ~= "" and address or "aplikasi PiwuApp") .. " → pilih Izinkan (Allow).\n" ..
  "2. Kalau pernah ditolak: View → Plugin Management, cari plugin PiwuApp, izinkan alamat itu, lalu ulangi.\n" ..
  "3. Jalan terakhir — setelan ini untuk script in-game, bukan izin plugin: File → Experience Settings → Security → Allow HTTP Requests" .. (place and " (sudah aktif di place ini)." or ".")
 httpNote.Visible = true
 copyHttpButton.Visible = not place
 copyHttpButton.Text = "Salin baris Command Bar (jalan terakhir)"
end
local function hideHttpHelp()
 httpNote.Visible = false
 copyHttpButton.Visible = false
end
local function request(method, path, body)
 assert(address ~= "" and credential ~= "", "Hubungkan token dan alamat terlebih dahulu.")
 hideHttpHelp()
 local ok, response = pcall(function()
  return Http:RequestAsync({Url=address .. "/api/studio/" .. path, Method=method, Headers={Authorization="Bearer " .. credential, ["Content-Type"]="application/json"}, Body=body and string.gsub(Http:JSONEncode(body), '"properties":%[%]', '"properties":{}') or nil})
 end)
 if not ok then
  local message = tostring(response)
  if pluginPermissionProblem(message) then
   showHttpHelp(string.sub(message, 1, 140))
   error("Studio menolak permintaan HTTP untuk plugin ini. Izinkan alamat " .. address .. " saat Studio bertanya (atau lewat View → Plugin Management), lalu coba lagi.", 0)
  end
  error("Tidak bisa menghubungi " .. address .. " — " .. string.sub(message, 1, 200), 0)
 end
 if not response.Success then
  local detail = ""
  local okDecode, decoded = pcall(function() return Http:JSONDecode(response.Body or "{}") end)
  if okDecode and type(decoded) == "table" and type(decoded.error) == "string" then detail = " · " .. string.sub(decoded.error, 1, 200) end
  error("Bridge menolak permintaan (HTTP " .. tostring(response.StatusCode) .. ")" .. detail .. ". Periksa koneksi, masa berlaku token, izin project, atau snapshot yang sudah berubah.", 0)
 end
 return Http:JSONDecode(response.Body)
end
-- assert() prefixes its message with the source position. The status line in the
-- panel is for a person, so that prefix is dropped here.
local function userMessage(message)
 local text = tostring(message)
 return string.match(text, "^%[string \"[^\"]*\"%]:%d+: (.*)") or string.match(text, "^[%w_%-%.]+%.luau:%d+: (.*)") or text
end
local function action(fn)
 if busy then return end
 busy = true; say("Memproses…")
 local ok, message = pcall(fn)
 if not ok then say("Gagal: " .. string.sub(userMessage(message), 1, 280)) end
 busy = false
end
local function checkEdit()
 assert(not Run:IsRunning(), "Hentikan Play/Run terlebih dahulu. Bridge hanya bekerja dalam Edit Mode.")
end
-- Stable ID attributes are added only when the user explicitly exports a snapshot.
-- Unknown/locked objects get read-only IDs and cannot be modified by this plugin.
local function snapshot(snapshotId, assign)
 checkEdit()
 local result = {version=1, snapshotId=snapshotId, placeId=tostring(game.PlaceId), nodes={}}
 local map, seen = {}, {}
 local scriptCount = 0
 local function visit(o, parentId, path, root)
  assert(#result.nodes < LIMITS.nodes, "Place melebihi " .. tostring(LIMITS.nodes) .. " instance. Snapshot dibatalkan, bukan dipotong.")
  local id = root and ("service:" .. o.ClassName) or o:GetAttribute("PiwuBridgeId")
  if not root and (type(id) ~= "string" or not string.match(id, "^[%w:%.%-_]+$") or #id > 100 or seen[id]) then
   assert(assign, "Instance baru/ID duplikat ditemukan. Ekspor snapshot ulang.")
   id = Http:GenerateGUID(false)
   local canSet = pcall(function() o:SetAttribute("PiwuBridgeId", id) end)
   assert(canSet, "Instance terkunci tidak dapat diidentifikasi dengan aman. Ekspor dibatalkan.")
  end
  assert(not seen[id], "ID duplikat. Ekspor dibatalkan.")
  seen[id] = true; map[id] = o
  local props = {}
  if o.ClassName == "Part" then
   props.position = array(o.Position)
   local x,y,z = o.CFrame:ToEulerAnglesXYZ()
   props.rotation = {math.deg(x),math.deg(y),math.deg(z)}
   props.size = array(o.Size); props.color = "#" .. o.Color:ToHex(); props.anchored = o.Anchored; props.shape = o.Shape.Name
  end
  local node = {id=id,parentId=parentId or "",name=o.Name,className=o.ClassName,properties=props}
  if isScript(o) then
   scriptCount += 1; assert(scriptCount <= LIMITS.scripts, "Snapshot melebihi " .. tostring(LIMITS.scripts) .. " script.")
   local ok, source = pcall(function() return Scripts:GetEditorSource(o) end)
   node.readable = ok
   if ok then
    assert(#source <= LIMITS.sourceBytes, "Source script melebihi 100 KB.")
    local extension = o.ClassName == "Script" and ".server.luau" or o.ClassName == "LocalScript" and ".client.luau" or ".luau"
    node.source = source; node.scriptPath = path .. "/" .. clean(o.Name) .. "_" .. string.sub(id,1,8) .. extension
    assert(#node.scriptPath <= 240, "Path script terlalu panjang.")
   end
  end
  table.insert(result.nodes,node)
  local childPath = root and clean(o.Name) or path .. "/" .. clean(o.Name)
  for _, child in o:GetChildren() do visit(child,id,childPath,false) end
 end
 for _, name in roots do
  local ok, service = pcall(function() return game:GetService(name) end)
  if ok then visit(service,nil,"",true) end
 end
 table.sort(result.nodes,function(a,b) return a.id < b.id end)
 assert(#Http:JSONEncode(result) <= LIMITS.snapshotBytes, "Snapshot melebihi 4 MB.")
 return result,map
end
local function validate(bundle, map)
 assert(type(bundle)=="table" and bundle.version==1 and type(bundle.id)=="string", "Bundle tidak valid.")
 assert(baseline and bundle.baseSnapshotId==baseline.snapshotId and bundle.placeId==tostring(game.PlaceId), "Place atau snapshot tidak cocok.")
 assert(type(bundle.changes)=="table" and #bundle.changes <= LIMITS.changes, "Maksimal " .. tostring(LIMITS.changes) .. " operasi per bundle.")
 local known, classes, seen, deleted = {}, {}, {}, {}
 for id,o in map do known[id]=true; classes[id]=o.ClassName end
 for _,c in bundle.changes do
  assert(c.op=="create" or c.op=="update" or c.op=="delete", "Operasi tidak didukung.")
  local id = c.op=="delete" and c.id or c.node.id
  assert(type(id)=="string" and not seen[id], "ID operasi tidak valid/duplikat."); seen[id]=true
  assert(not string.match(id,"^service:"), "Service root tidak boleh diubah.")
  if c.op=="delete" then
   assert(map[id] and editable[map[id].ClassName], "Objek ini tidak boleh dihapus.")
   for _,child in map[id]:GetDescendants() do assert(editable[child.ClassName],"Descendant read-only; penghapusan ditolak.") end
   deleted[id]=true
  else
   local n=c.node
   assert(editable[n.className] and type(n.name)=="string" and #n.name>0 and #n.name<=400,"Class/nama tidak didukung.")
   assert(type(n.parentId)=="string" and n.parentId~="", "Parent diperlukan.")
   if c.op=="create" then assert(not map[id],"ID sudah ada.")
   else assert(map[id] and map[id].ClassName==n.className,"Instance berubah.") end
   if scriptClasses[n.className] then assert(type(n.source)=="string" and #n.source<=LIMITS.sourceBytes,"Source tidak valid atau tidak dapat dibaca.") end
   local props=n.properties
   assert(type(props)=="table","Properties diperlukan.")
   for key,value in props do
    assert(key=="position" or key=="rotation" or key=="size" or key=="color" or key=="anchored" or key=="shape","Property tidak didukung.")
    if key=="position" or key=="rotation" or key=="size" then
     assert(type(value)=="table" and #value==3,"Vector harus berisi tiga angka.")
     for _,v in value do assert(type(v)=="number" and v==v and math.abs(v)<=100000,"Angka tidak valid.") if key=="size" then assert(v>=.05 and v<=1000,"Ukuran tidak valid.") end end
    elseif key=="color" then assert(type(value)=="string" and string.match(value,"^#%x%x%x%x%x%x$"),"Warna tidak valid.")
    elseif key=="shape" then assert(value=="Block" or value=="Ball" or value=="Cylinder","Shape tidak valid.")
    elseif key=="anchored" then assert(type(value)=="boolean","Anchored tidak valid.") end
   end
   known[id]=true; classes[id]=n.className
  end
 end
 for _,c in bundle.changes do if c.op~="delete" then assert(known[c.node.parentId] and not deleted[c.node.parentId],"Parent tidak tersedia.") end end
end
local function applyNode(o,n)
 o.Name=n.name
 -- A bundle's rotation comes from this plugin's own snapshot (ToEulerAnglesXYZ),
 -- so the documented inverse CFrame.Angles/fromEulerAnglesXYZ is the exact
 -- round-trip partner here.
 if o.ClassName=="Part" then
  local p=n.properties
  local position=p.position and Vector3.new(table.unpack(p.position)) or o.Position
  local rx,ry,rz=o.CFrame:ToEulerAnglesXYZ()
  if p.rotation then rx,ry,rz=math.rad(p.rotation[1]),math.rad(p.rotation[2]),math.rad(p.rotation[3]) end
  o.CFrame=CFrame.new(position)*CFrame.Angles(rx,ry,rz)
  if p.size then o.Size=Vector3.new(table.unpack(p.size)) end
  if p.color then o.Color=Color3.fromHex(string.sub(p.color,2)) end
  if p.anchored~=nil then o.Anchored=p.anchored end
  if p.shape then o.Shape=Enum.PartType[p.shape] end
 elseif isScript(o) then
  Scripts:UpdateSourceAsync(o,function() return n.source end)
 end
end
-- Rotation is RX·RY·RZ: the product Three.js builds for an XYZ Euler angle, and
-- the same maths server/lib/lowpoly.mjs and src/lib/roblox/glb.ts use. A vector
-- meets RZ first (rightmost factor), then RY, then RX. Roblox's own
-- CFrame.fromEulerAnglesXYZ (and CFrame.Angles) is documented as exactly this
-- product too, so poseCFrame builds the three basis vectors and hands them to
-- CFrame.fromMatrix — the same result, with the matrix written out.
local function spin(rotation, v)
 local rx,ry,rz = math.rad(rotation[1]),math.rad(rotation[2]),math.rad(rotation[3])
 local x,y,z = v[1],v[2],v[3]
 local ax,ay = x*math.cos(rz)-y*math.sin(rz), x*math.sin(rz)+y*math.cos(rz)
 local bx,by,bz = ax*math.cos(ry)+z*math.sin(ry), ay, -ax*math.sin(ry)+z*math.cos(ry)
 return bx, by*math.cos(rx)-bz*math.sin(rx), by*math.sin(rx)+bz*math.cos(rx)
end
local function poseCFrame(position, rotation)
 local rx,ry,rz = spin(rotation,{1,0,0})
 local ux,uy,uz = spin(rotation,{0,1,0})
 local bx,by,bz = spin(rotation,{0,0,1})
 return CFrame.new(position[1],position[2],position[3]) * CFrame.fromMatrix(Vector3.zero, Vector3.new(rx,ry,rz), Vector3.new(ux,uy,uz), Vector3.new(bx,by,bz))
end
local partShapes = {block=Enum.PartType.Block, sphere=Enum.PartType.Ball, cylinder=Enum.PartType.Cylinder}
local function checkScene(scene)
 assert(type(scene)=="table" and scene.version==1 and type(scene.objects)=="table", "Scene project tidak valid.")
 assert(#scene.objects <= LIMITS.sceneObjects, "Scene melebihi " .. tostring(LIMITS.sceneObjects) .. " objek.")
 local byId = {}
 for _,o in scene.objects do
  assert(type(o.id)=="string" and #o.id>0 and #o.id<=100, "Objek scene tanpa id.")
  assert(partShapes[o.kind] or o.kind=="mesh" or o.kind=="model", "Jenis objek scene tidak dikenal: " .. tostring(o.kind))
  assert(type(o.position)=="table" and #o.position==3 and type(o.rotation)=="table" and #o.rotation==3, "Transform objek scene tidak valid.")
  assert(type(o.size)=="table" and #o.size==3, "Ukuran objek scene tidak valid.")
  assert(type(o.color)=="string" and string.match(o.color,"^#%x%x%x%x%x%x$"), "Warna objek scene tidak valid.")
  assert(not byId[o.id], "Id objek scene dipakai dua kali.")
  byId[o.id] = o
 end
 for _,o in scene.objects do
  if o.parent~=nil then
   assert(byId[o.parent] and byId[o.parent].kind=="model", "Parent objek scene bukan Model.")
   -- A cycle would make buildScene recurse forever, so it is refused here.
   local walk, seen = o.parent, {[o.id]=true}
   while walk do
    assert(not seen[walk], "Parent objek scene membentuk siklus.")
    seen[walk]=true
    walk=byId[walk].parent
   end
  end
 end
 return byId
end
local function sceneLines(scene, assets, summary)
 local lines = {"SCENE PROJECT — tinjau dulu, baru bangun:", "Objek: " .. tostring(summary.objects or #scene.objects)}
 for kind, total in pairs(summary.kinds or {}) do table.insert(lines, "· " .. kind .. ": " .. tostring(total)) end
 for _,o in scene.objects do
  local asset = assets[o.id]
  local tag = o.kind=="mesh" and (asset and ("aset #" .. tostring(asset.assetId)) or "BELUM punya aset → dilewati") or ""
  if #lines < 42 then
   table.insert(lines, string.format("%s · %s [%s] %.1f, %.1f, %.1f · %.1fx%.1fx%.1f stud %s", o.name, o.kind, o.color, o.position[1], o.position[2], o.position[3], o.size[1], o.size[2], o.size[3], tag))
  end
 end
 if #scene.objects > 30 then table.insert(lines, "…dan " .. tostring(#scene.objects - 30) .. " baris lain tidak ditampilkan.") end
 return lines
end
local function buildScene(scene, assets, options)
 checkEdit()
 local byId = checkScene(scene)
 local group = options.group
 local rootWorld = options.rootWorld or CFrame.new()
 local live, worldOf = {}, {}
 local parts, models, meshes, skipped = 0, 0, 0, {}
 -- World transform of one scene object, memoised; an object's parent is always a
 -- Model, and checkScene already refused cycles.
 local function worldOfId(id)
  local o = byId[id]
  if not o then return rootWorld end
  if not worldOf[id] then worldOf[id] = worldOfId(o.parent) * poseCFrame(o.position, o.rotation) end
  return worldOf[id]
 end
 -- Pass 1: create every instance, still unattached, so a child can be parented to
 -- a Model that appears later in the file.
 for _,o in scene.objects do
  if partShapes[o.kind] then
   local part = Instance.new("Part")
   part.Name = o.name
   part.Shape = partShapes[o.kind]
   part.Anchored = o.anchored
   part.Size = Vector3.new(o.size[1], o.size[2], o.size[3])
   part.Color = Color3.fromHex(string.sub(o.color,2))
   part.Material = Enum.Material.SmoothPlastic
   part:SetAttribute("PiwuBridgeId", "scene:" .. o.id)
   live[o.id] = part
   parts += 1
  elseif o.kind == "model" then
   local model = Instance.new("Model")
   model.Name = o.name
   model:SetAttribute("PiwuBridgeId", "scene:" .. o.id)
   live[o.id] = model
   models += 1
  else
   local asset = assets[o.id]
   if asset and asset.assetId then
    local ok, loaded = pcall(function() return Insert:LoadAsset(tonumber(asset.assetId)) end)
    if ok and loaded then
     loaded.Name = o.name
     loaded:SetAttribute("PiwuBridgeId", "scene:" .. o.id)
     live[o.id] = loaded
     meshes += 1
    else
     table.insert(skipped, o.name .. " (aset #" .. tostring(asset.assetId) .. " gagal dimuat: moderasi/pemilik aset)")
    end
   else
    table.insert(skipped, o.name .. " (mesh kustom tanpa aset Roblox)")
   end
  end
 end
 -- Pass 2: the same hierarchy the app's own viewport shows — a child of a Model
 -- goes inside it, so moving that Model in Studio moves its parts. The CFrames
 -- below stay world-space, exactly like in the app.
 for _,o in scene.objects do
  if live[o.id] then live[o.id].Parent = o.parent and live[o.parent] or group end
 end
 -- Pass 3: transforms. Every Model pivot first: PivotTo moves a model's
 -- descendants, so each child's own world CFrame must be written afterwards.
 for _,o in scene.objects do
  if o.kind == "model" and live[o.id] then live[o.id]:PivotTo(worldOfId(o.id)) end
 end
 for _,o in scene.objects do
  local instance = live[o.id]
  if instance and partShapes[o.kind] then
   instance.CFrame = worldOfId(o.id)
  elseif instance and o.kind == "mesh" then
   -- The .glb uploaded for this object already carries its size and rotation,
   -- so only the placement is applied; the parent's transform still reaches it
   -- through the model it is parented to.
   local parentWorld = o.parent and worldOfId(o.parent) or rootWorld
   instance:PivotTo(parentWorld * CFrame.new(o.position[1], o.position[2], o.position[3]))
  end
 end
 return {parts=parts, models=models, meshes=meshes, skipped=skipped}
end
copyHttpButton.MouseButton1Click:Connect(function()
 local copied = pcall(function() setclipboard(HTTP_COMMAND) end)
 say(copied and ("Baris disalin. Tempel di Command Bar lalu Enter: " .. HTTP_COMMAND) or ("Salin manual ke Command Bar: " .. HTTP_COMMAND))
end)
connectButton.MouseButton1Click:Connect(function()
 action(function()
  checkEdit()
  local url=string.gsub(origin.Text,"/+$","")
  assert(string.match(url,"^https://[%w%.%-]+:?%d*$"),"Gunakan origin HTTPS tanpa path, query, atau username.")
  assert(#tokenInput.Text>=32 and #tokenInput.Text<=200,"Token pasangan tidak valid.")
  address=url; credential=tokenInput.Text; tokenInput.Text=""; baseline=nil; pending=nil; scenePlan=nil
  hideHttpHelp()
  say("Koneksi disimpan hanya di memori. Tujuan: "..address..". Klik Tes koneksi untuk memastikan project-nya benar sebelum mengirim snapshot script.")
 end)
end)
checkButton.MouseButton1Click:Connect(function()
 action(function()
  local d = request("GET","status",nil)
  local project = d.project or {}
  local bridge = d.bridge or {}
  local scene = d.scene
  local lines = {
   "Project: " .. tostring(project.name) .. " (" .. tostring(project.kind) .. ")",
   "Token berlaku sampai: " .. tostring(bridge.expiresAt),
   "Antrean: status " .. tostring(bridge.state) .. (tonumber(bridge.queuedChanges) and tonumber(bridge.queuedChanges) > 0 and (" · " .. tostring(bridge.queuedChanges) .. " perubahan menunggu") or ""),
   "Snapshot tersimpan di server: " .. tostring(bridge.snapshotNodes or 0) .. " instance" .. (bridge.placeId ~= "" and (" · place " .. tostring(bridge.placeId) .. (tostring(bridge.placeId) == tostring(game.PlaceId) and "" or " (BEDA dengan place ini!)")) or ""),
  }
  if tostring(bridge.placeId) ~= "" and tostring(bridge.placeId) ~= tostring(game.PlaceId) then
   table.insert(lines, "PERINGATAN: snapshot terakhir dikirim dari place lain. Kirim snapshot dari place ini sebelum menerapkan perubahan.")
  end
  if scene then
   table.insert(lines, "Scene project: " .. tostring(scene.objects) .. " objek · " .. tostring(scene.meshes and scene.meshes.total or 0) .. " mesh kustom (" .. tostring(scene.meshes and scene.meshes.withAsset or 0) .. " punya aset Roblox)")
  else
   table.insert(lines, "Scene project: belum ada/belum bisa dipakai — " .. tostring(d.sceneProblem ~= "" and d.sceneProblem or "tidak dijelaskan"))
  end
  table.insert(lines, "Izin HTTP plugin: aktif untuk alamat ini (Studio mengingat pilihan Anda tiap domain; cabut atau ubah di View → Plugin Management).")
  if d.plugin and d.plugin.version and d.plugin.version ~= VERSION then
   table.insert(lines, "VERSI BEDA: server memakai plugin " .. tostring(d.plugin.version) .. ", yang terpasang " .. VERSION .. ". Unduh ulang PiwuStudio.rbxmx dari panel Hubungkan Studio lalu timpa berkas di folder Plugins.")
  end
  table.insert(lines, "Unggah aset ke Roblox di server ini: " .. (d.assets and d.assets.configured and "aktif" or "belum dikonfigurasi (pakai impor GLB manual)"))
  review.Text = table.concat(lines, "\n")
  say("Koneksi OK · project " .. tostring(project.name) .. " · server memakai plugin " .. tostring(d.plugin and d.plugin.version or "?"))
 end)
end)
-- One snapshot path for the button and for live mode. `assign` writes stable
-- PiwuBridgeId attributes; live mode always assigns so new instances can be
-- addressed by the next bundle.
local function pushSnapshot(assign)
 local data=snapshot(Http:GenerateGUID(false),assign ~= false)
 request("POST","snapshot",data)
 baseline=data; pending=nil; confirmUntil=0
 return data
end
sendButton.MouseButton1Click:Connect(function()
 action(function()
  local data=pushSnapshot(true)
  say("Snapshot terkirim: "..tostring(#data.nodes).." instance. AI di PiwuApp otomatis membaca source-nya; impor hanya perlu bila Anda ingin mengedit file di web. Tidak ada script yang dijalankan.")
 end)
end)
fetchButton.MouseButton1Click:Connect(function()
 action(function()
  checkEdit(); assert(baseline,"Kirim snapshot dari plugin ini terlebih dahulu.")
  local d=request("GET","pending",nil)
  pending=d.bundle; confirmUntil=0
  if not pending then setWaiting(false); say("Tidak ada bundle dalam antrean. Status: "..tostring(d.state));return end
  setWaiting(true)
  local _,map=snapshot(baseline.snapshotId,false);validate(pending,map)
  local lines={"TINJAU DI PIWUAPP SEBELUM MENERAPKAN:"}
  for _,c in pending.changes do table.insert(lines,c.op.." · "..(c.op=="delete" and c.id or c.node.name.." / "..c.node.className)) end
  review.Text=table.concat(lines,"\n");say(tostring(#pending.changes).." operasi. Tombol Terapkan meminta konfirmasi kedua, termasuk penghapusan.")
 end)
end)
-- Claim, mutate and receipt one reviewed bundle. The server compares the whole
-- snapshot at claim time, so a place that changed locally is a conflict, never
-- an overwrite. This is a function (not only a button handler) so the Luau
-- harness in tests/studio-plugin.test.ts can drive it without Studio.
local function applyBundle(bundle, current, map)
 local recording=History:TryBeginRecording("PiwuStudioBridge","Perubahan PiwuApp")
 if not recording then return {ok=false,claimed=false,ack=false,error="Studio sedang memiliki recording lain. Coba lagi setelah selesai."} end
 local claimed, claimError = pcall(function() request("POST","claim",{id=bundle.id,snapshot=current}) end)
 if not claimed then
  History:FinishRecording(recording,Enum.FinishRecordingOperation.Cancel)
  return {ok=false,claimed=false,ack=false,error=tostring(claimError)}
 end
 applied[bundle.id]=true
 local ok=pcall(function()
  -- Create unattached objects first, then assign safe parents and properties.
  for _,c in bundle.changes do if c.op=="create" then local o=Instance.new(c.node.className);o:SetAttribute("PiwuBridgeId",c.node.id);if o:IsA("BaseScript") then o.Disabled=true end;if o:IsA("BasePart") then o.Anchored=true end;map[c.node.id]=o end end
  for _,c in bundle.changes do if c.op~="delete" then map[c.node.id].Parent=map[c.node.parentId];applyNode(map[c.node.id],c.node) end end
  for _,c in bundle.changes do if c.op=="delete" then map[c.id]:Destroy() end end
 end)
 -- A partial failure is deliberately NOT called atomic/successful; the recording
 -- is committed so the user can undo every mutation that actually happened.
 History:FinishRecording(recording,Enum.FinishRecordingOperation.Commit)
 local ack=pcall(function() request("POST","ack",{id=bundle.id,ok=ok}) end)
 return {ok=ok,claimed=true,ack=ack,error=ok and "" or "PERUBAHAN PARSIAL/GAGAL: gunakan Undo di Studio dan periksa place sebelum snapshot baru."}
end
-- Live mode is opt-in. It applies only a bundle an Owner/Editor already sent
-- from PiwuApp and the server already validated; local Studio edits still make
-- the claim fail. After a successful receipt it pushes a fresh snapshot so the
-- AI context and the next bundle start from the place that just changed.
local function liveApply(bundle)
 baseline = baseline or {snapshotId=bundle.baseSnapshotId, placeId=bundle.placeId}
 local current,map=snapshot(baseline.snapshotId,false)
 validate(bundle,map)
 local result=applyBundle(bundle,current,map)
 pending=nil; confirmUntil=0
 if not result.claimed then error(result.error,0) end
 if not result.ok then error(result.error,0) end
 if not result.ack then error("Diterapkan, tetapi receipt gagal dikirim. Sinkron langsung dimatikan; periksa place dan jangan ulangi bundle.",0) end
 pushSnapshot(true)
 return result
end
applyButton.MouseButton1Click:Connect(function()
 action(function()
  checkEdit();assert(pending and baseline,"Ambil bundle dahulu.");assert(not applied[pending.id],"Bundle ini pernah dicoba. Jangan ulangi; periksa Studio lalu ambil snapshot baru.")
  if os.clock()>confirmUntil then confirmUntil=os.clock()+12;say("KONFIRMASI: "..tostring(#pending.changes).." perubahan termasuk script/penghapusan. Klik Terapkan sekali lagi dalam 12 detik. Simpan backup place dahulu.");return end
  confirmUntil=0
  local current,map=snapshot(baseline.snapshotId,false);validate(pending,map)
  local result=applyBundle(pending,current,map)
  pending=nil;baseline=nil;setWaiting(false)
  if not result.claimed then error(result.error,0) end
  if not result.ok then say(result.error .. " Tidak akan dicoba ulang otomatis.")
  elseif not result.ack then say("Diterapkan di Studio, receipt gagal dikirim. Jangan ulangi bundle. Cabut/pasangkan ulang bridge setelah memeriksa place.")
  else say("Perubahan diterapkan. Script baru tetap Disabled. Review, aktifkan manual, lalu Play Test di Studio. Kirim snapshot baru sebelum perubahan berikutnya.") end
 end)
end)
sceneButton.MouseButton1Click:Connect(function()
 action(function()
  checkEdit();assert(baseline or address ~= "", "Simpan koneksi dahulu.")
  local d=request("GET","scene",nil)
  -- Refuse at review time too: a scene the plugin cannot trust must never be
  -- offered as "ready to build".
  checkScene(d.scene)
  scenePlan={scene=d.scene, assets=d.assets or {}, summary=d.summary or {}, notes=d.notes or {}}
  sceneConfirmUntil=0
  local lines=sceneLines(d.scene, d.assets or {}, d.summary or {})
  for _,n in d.notes or {} do table.insert(lines, "CATATAN: " .. tostring(n)) end
  table.insert(lines, "")
  table.insert(lines, "Folder tujuan: " .. (inSelection and "objek terpilih" or "Workspace") .. " → " .. SCENE_FOLDER)
  table.insert(lines, "Bangun scene memakai satu recording Undo. Klik 'Bangun scene' dua kali untuk konfirmasi.")
  review.Text=table.concat(lines,"\n")
  say(tostring(#d.scene.objects).." objek siap dibangun ("..tostring((d.summary.meshes or {}).total or 0).." mesh kustom).")
 end)
end)
sceneApplyButton.MouseButton1Click:Connect(function()
 action(function()
  checkEdit();assert(scenePlan, "Impor scene project dahulu supaya bisa ditinjau.")
  if os.clock()>sceneConfirmUntil then
   sceneConfirmUntil=os.clock()+12
   say("KONFIRMASI: bangun "..tostring(#scenePlan.scene.objects).." objek dari scene project ke "..(inSelection and "objek terpilih" or "Workspace")..". Klik 'Bangun scene' sekali lagi dalam 12 detik.")
   return
  end
  sceneConfirmUntil=0
  local rootWorld, root
  if inSelection then
   local chosen = Selection:Get()[1]
   assert(chosen and (chosen:IsA("Model") or chosen:IsA("Folder")), "Pilih satu Model/Folder sebagai induk, atau matikan opsi induk.")
   root = chosen
   rootWorld = chosen:IsA("Model") and chosen:GetPivot() or CFrame.new()
  else
   rootWorld = CFrame.new()
  end
  local recording=History:TryBeginRecording("PiwuSceneImport","Impor scene PiwuApp")
  assert(recording,"Studio sedang memiliki recording lain. Coba lagi setelah selesai.")
  local ok, report = pcall(function()
   -- Checked again right before mutating: the plan must still be trustworthy.
   checkScene(scenePlan.scene)
   local group
   if inSelection then
    group = root
   else
    local existing = workspace:FindFirstChild(SCENE_FOLDER)
    if existing and replaceScene and existing:IsA("Folder") then existing:Destroy() end
    group = Instance.new("Folder")
    group.Name = SCENE_FOLDER
    group.Parent = workspace
   end
   return buildScene(scenePlan.scene, scenePlan.assets, {group=group, rootWorld=rootWorld})
  end)
  History:FinishRecording(recording, ok and Enum.FinishRecordingOperation.Commit or Enum.FinishRecordingOperation.Cancel)
  if not ok then say("Impor scene gagal: " .. string.sub(tostring(report), 1, 240) .. " Tidak ada perubahan yang disimpan; gunakan Undo bila Explorer berubah."); return end
  local lines = {"IMPOR SELESAI. Periksa Explorer lalu Play Test di Studio Anda sendiri.", "Part: " .. tostring(report.parts) .. " · Model: " .. tostring(report.models) .. " · Mesh dari aset Roblox: " .. tostring(report.meshes)}
  if #report.skipped > 0 then
   table.insert(lines, "Dilewati " .. tostring(#report.skipped) .. " objek — tidak ada yang dikarang:")
   for _,item in report.skipped do table.insert(lines, "· " .. tostring(item)) end
   table.insert(lines, "Untuk mesh itu: Ekspor GLB di panel Properti PiwuApp lalu impor lewat 3D Importer, atau unggah lewat Open Cloud bila server dikonfigurasi.")
  end
  table.insert(lines, "Jika ada yang salah: Ctrl+Z satu kali membatalkan seluruh impor ini (satu recording).")
  review.Text = table.concat(lines, "\n")
  say("Scene dibangun: " .. tostring(report.parts + report.models + report.meshes) .. " instance, " .. tostring(#report.skipped) .. " dilewati. Satu Ctrl+Z membatalkan semuanya.")
  scenePlan = nil
 end)
end)
sceneReplace.MouseButton1Click:Connect(function()
 replaceScene = not replaceScene
 sceneReplace.Text = "Ganti folder PiwuScene yang sudah ada: " .. (replaceScene and "YA" or "TIDAK")
end)
sceneInSelection.MouseButton1Click:Connect(function()
 inSelection = not inSelection
 sceneInSelection.Text = "Pakai objek terpilih sebagai induk: " .. (inSelection and "YA" or "TIDAK")
end)
liveSync.MouseButton1Click:Connect(function()
 liveEnabled = not liveEnabled
 liveLabel()
 if liveEnabled then
  say("Sinkron langsung AKTIF: bundle yang Anda kirim dari PiwuApp diterapkan otomatis dalam ~5 detik, tanpa konfirmasi kedua di Studio. Hanya bundle yang lolos validasi server; perubahan lokal Studio tetap menjadi konflik. Script baru tetap Disabled. Matikan bila place tidak diawasi.")
 else
  say("Sinkron langsung dimatikan. Tombol Terapkan kembali meminta konfirmasi kedua.")
 end
end)
autoPoll.MouseButton1Click:Connect(function()
 pollEnabled = not pollEnabled
 autoPoll.Text = "Periksa antrean otomatis tiap 20 detik: " .. (pollEnabled and "YA (hanya memberi tahu)" or "TIDAK")
 say(pollEnabled and "Pemeriksaan otomatis hanya MEMBERI TAHU; tidak ada perubahan yang diterapkan tanpa klik Anda." or "Pemeriksaan otomatis dimatikan.")
end)
clearButton.MouseButton1Click:Connect(function()
 address="";credential="";tokenInput.Text="";baseline=nil;pending=nil;scenePlan=nil;confirmUntil=0;sceneConfirmUntil=0;liveEnabled=false;liveLabel()
 hideHttpHelp();setWaiting(false)
 say("Token lokal dihapus. Cabut akses juga melalui PiwuApp untuk mencabut token server.")
end)
toggle.Click:Connect(function() widget.Enabled=not widget.Enabled end)
plugin.Unloading:Connect(function() credential="";baseline=nil;pending=nil;scenePlan=nil;liveEnabled=false end)
-- Quiet polling by default: only asks the server whether a bundle is waiting.
-- With live mode on it applies that reviewed bundle, disables itself on the
-- first failure, and never retries automatically.
task.spawn(function()
 while true do
  task.wait(liveEnabled and 5 or 20)
  if (pollEnabled or liveEnabled) and not busy and widget.Enabled and address ~= "" then
   local ok, d = pcall(function() return request("GET","pending",nil) end)
   if ok and d.bundle and not applied[d.bundle.id] then
    local count = d.bundle.changes and #d.bundle.changes or 0
    setWaiting(true)
    if liveEnabled then
     busy = true
     local appliedOk, applyError = pcall(function() liveApply(d.bundle) end)
     busy = false
     if appliedOk then
      setWaiting(false)
      say("Sinkron langsung: " .. tostring(count) .. " perubahan diterapkan dan snapshot baru dikirim. Script baru tetap Disabled; jalankan Play Test sendiri.")
     else
      liveEnabled = false; liveLabel(); setWaiting(false)
      say("Sinkron langsung DIMATIKAN: " .. string.sub(userMessage(applyError), 1, 240) .. " Tidak ada percobaan ulang otomatis; periksa lalu ambil & terapkan manual.")
     end
    else
     say("Ada " .. tostring(count) .. " perubahan menunggu di PiwuApp. Klik 2 · Ambil & tinjau perubahan (tidak ada yang diterapkan tanpa review).")
    end
   elseif not ok then
    autoPoll.Text = "Periksa antrean otomatis tiap 20 detik: YA (gagal: " .. string.sub(tostring(d), 1, 60) .. ")"
   end
  end
 end
end)
-- Test seam: the Luau harness in tests/studio-plugin.test.ts runs this file with
-- a fake DataModel and needs the internals; in Studio `_PIWU_TEST` is nil, so the
-- plugin body behaves exactly as it does above.
if _PIWU_TEST then
 return {
  version = VERSION,
  limits = LIMITS,
  snapshot = snapshot,
  validate = validate,
  applyBundle = applyBundle,
  applyNode = applyNode,
  checkScene = checkScene,
  buildScene = buildScene,
  poseCFrame = poseCFrame,
  spin = spin,
  sceneLines = sceneLines,
  request = request,
  connect = function(url, token) address = url; credential = token end,
  origin = function() return address end,
  waiting = function() return string.find(widget.Title, "perubahan menunggu") ~= nil end,
  live = function() return liveEnabled end,
  liveApply = liveApply,
  setReplace = function(value) replaceScene = value end,
  httpCommand = HTTP_COMMAND,
  ui = {status=status, review=review, httpNote=httpNote, copyHttp=copyHttpButton, origin=origin, tokenInput=tokenInput, buttons={connect=connectButton, check=checkButton, send=sendButton, fetch=fetchButton, apply=applyButton, scene=sceneButton, sceneApply=sceneApplyButton, clear=clearButton, autoPoll=autoPoll, liveSync=liveSync, sceneReplace=sceneReplace, sceneInSelection=sceneInSelection}},
 }
end
