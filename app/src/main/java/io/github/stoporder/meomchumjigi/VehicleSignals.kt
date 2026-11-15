package io.github.stoporder.meomchumjigi

/**
 * 차량 신호가 들어오는 곳. 화면(판정 로직)은 이 인터페이스만 본다.
 * 좌석 번호: 0 운전석, 1 조수석, 2 뒷좌석 왼쪽, 3 뒷좌석 가운데, 4 뒷좌석 오른쪽.
 * 도어 키: fl 운전석, fr 조수석, rl 뒷좌석 왼쪽, rr 뒷좌석 오른쪽.
 */
interface SignalSink {
    fun onSpeed(kmh: Int, onHighway: Boolean)
    fun onTelltales(names: List<String>)
    fun onAirbagDeployed()
    fun onDoor(key: String, open: Boolean)
    fun onSeat(index: Int, occupied: Boolean)
}

/** 신호를 내주는 쪽. 실차(Pleos Vehicle SDK)와 시연(정해진 각본) 두 구현이 있다. */
interface VehicleSignalSource {
    /** 화면 아래 띠에 보이는 이름 */
    val label: String
    val isDemo: Boolean
    fun start(sink: SignalSink)
    fun stop()
    /** 대피 안내 중 미등·후방 안개등·실내등을 켜고, 끝나면 원래대로 돌린다. */
    fun setEvacLamps(on: Boolean)
}
