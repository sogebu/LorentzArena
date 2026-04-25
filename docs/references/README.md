# References

LorentzArena が依拠する / 直接の元ネタとなっている公開論文・素材の archive。  
出版側 Open Access ライセンスの範囲で PDF 実体を同梱しています。  
外部素材 (イラスト等) は再配布禁止のものが多いため、本リポには素材ファイルを含めず、
出典 URL とライセンス概要を本ファイルに記録します。

## Nakayama & Oda, "Relativity for games" (PTEP 2017)

**File**: [`Nakayama-Oda-2017-relativity-for-games-PTEP.pdf`](./Nakayama-Oda-2017-relativity-for-games-PTEP.pdf)

- Daiju Nakayama and Kin-ya Oda (尾田欣也), "Relativity for games"
- Progress of Theoretical and Experimental Physics, 2017, 113J01
- DOI: [10.1093/ptep/ptx127](https://doi.org/10.1093/ptep/ptx127)
- arXiv: [1703.07063 [physics.class-ph]](https://arxiv.org/abs/1703.07063)
- 出版年: 2017

LorentzArena の相対論物理実装 (光円錐交差、past-cone rendering、worldline 表現、laser の retarded-time 発射等) の設計基盤はこの論文に基づく。

### License

PTEP 誌は 2012 年以降 [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/) 下の完全 Open Access。本 PDF はそのライセンスに基づき再配布している。引用・派生利用は **attribution (著者 / 誌名 / DOI / CC BY 4.0 へのリンク) を残す限り**、改変・商用利用を含めて自由。

### 引用 BibTeX

```bibtex
@article{Sogebu,
    author = "Nakayama, Daiju and Oda, Kin-ya",
    title = "{Relativity for games}",
    eprint = "1703.07063",
    archivePrefix = "arXiv",
    primaryClass = "physics.class-ph",
    doi = "10.1093/ptep/ptx127",
    journal = "PTEP",
    volume = "2017",
    number = "11",
    pages = "113J01",
    year = "2017"
}
```

## External art assets

### ジャパクリップ「クラゲ」 — JellyfishShipRenderer の motif

- **Source URL**: https://japaclip.com/jellyfish/
- **Site terms**: https://japaclip.com/terms/
- **Used by**: [`2+1/src/components/game/JellyfishShipRenderer.tsx`](../../2+1/src/components/game/JellyfishShipRenderer.tsx)

Shooter mode の 3 機目 (クラゲ機体) のシルエット・色合い・顔まわりの design motif として参照。実装は procedural 3D (LatheGeometry の dome、Verlet rope の触手、半透明水色マテリアル等) で、元 PNG 自体は repo に含めていない。

### License 概要 (2026-04 確認)

| 項目 | 可否 |
|---|---|
| 商用利用 | OK |
| 改変・加工 (= 3D モデル化はその延長) | OK |
| ゲーム / アプリ組込 | OK |
| クレジット表記 | 任意 (本ファイルで記録) |
| **イラスト素材として配布** | **NG** |
| LINE スタンプ等 | NG |
| 公序良俗反 | NG |

「素材として配布」NG の制約により、本リポ (public) に元 PNG を commit しない運用。3D
モデル成果物 (procedural code / 自作 .glb) は派生物として OK と解釈。著作権はジャパクリップ側に残る (放棄しない)。
