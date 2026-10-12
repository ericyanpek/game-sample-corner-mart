# Blender 资产

游戏里的每个模型都由 Python 脚本在 Blender 中生成，同时保留可编辑的 `.blend` 源文件。没有下载模型，也没有贴图。

## 文件分布

| 位置 | 内容 |
|---|---|
| `assets/source/*.py` | 生成脚本，在 Blender 内部运行（`helpers.py` 是公共操作，`optimize_gltf.py` 负责合并完全相同的静态网格） |
| `assets/source/*.blend` | 生成结果，可以直接用 Blender 打开继续改 |
| `assets/specs/*.json` | 资产接口：挂点名、尺寸、容量、商品槽位、契约版本 |
| `public/assets/**/*.glb` | 游戏实际加载的模型 |
| `public/assets/**/*.webp` | 面板里的预览图 |
| `scripts/build_*.py` | 包装器：以后台模式启动 Blender，运行对应的生成脚本 |
| `scripts/fix_*.mjs` | 导出后对 GLB 做的小修补（收银台比例、货架接缝、展示资产） |

## 准备 Blender

使用 Blender 5.2 LTS。脚本默认调用 `PATH` 里的 `blender`，也可以用环境变量指定：

```sh
export BLENDER_BIN=/path/to/blender
```

生成脚本必须由 Blender 自带的 Python 运行，不能用系统的 `python3` 直接跑。包装器已经处理好了这一点。

## 打开源文件

```sh
python3 launch.py --source drink-shelf-lit
python3 launch.py --source shopping-basket
python3 launch.py --source day-sign
```

可选的源文件名见 `python3 launch.py --help`。不带参数运行 `launch.py` 会直接在本地打开已经构建好的 `dist/`。

## 资产接口

游戏不靠模型"长得对"来工作，而是靠**命名对象和自定义属性**：

- 货架上的每个商品单元都是独立对象。顾客拿走一件，对应的那一件就会消失。
- 顾客站位、店员上货点等用命名空对象标出，例如 `shelf.drinks`、`stop.drinks`。
- 根对象的自定义属性（glTF `extras`）里写有契约名和容量，例如购物篮的 `slot_contract` 和 `capacity`。

`view.ts` 加载模型时会逐项核对这些信息，对不上就报错，不会悄悄显示一个错位的模型。`npm test` 也会读取部分 GLB 做同样的检查。

## 修改一处资产

以带灯饮料架为例：

1. `python3 launch.py --source drink-shelf-lit`，改灯带材质的颜色。**不要改名、删除或移动任何带接口名的对象。**
2. 另存为你自己的 `.blend`，避免以后重跑生成脚本时覆盖手工修改。
3. 只选中货架根对象及其子对象，导出 glTF Binary，勾选 *Include → Custom Properties*，覆盖 `public/assets/shelves/lit.glb`。
4. `npm test`，然后 `npm run dev`，在游戏里升级到带灯架，确认外观变了、经营进度不变。

## 重新生成

```sh
python3 scripts/build_shelves.py     # 三档饮料架
python3 scripts/build_basket.py      # 双商品购物篮
python3 scripts/build_day_sign.py    # 营业告示牌
python3 scripts/build_restocking_crates.py
```

每次运行会在本地 `evidence/` 下写入 Blender 日志，这个目录已被 `.gitignore` 忽略。

注意，这些脚本是一轮轮迭代写出来的：后一轮会打开前一轮保存的 `.blend`，在上面局部修改后另存。因此它们记录的是一条修改链，不是一组可以任意顺序运行的独立配方。重跑某一步会覆盖这一步的产物，但不会自动合并你的手工修改。
