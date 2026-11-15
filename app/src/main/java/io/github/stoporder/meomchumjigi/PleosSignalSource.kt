package io.github.stoporder.meomchumjigi

import android.car.Car
import android.car.VehiclePropertyIds
import android.car.hardware.CarPropertyValue
import android.car.hardware.property.CarPropertyManager
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import ai.pleos.playground.vehicle.Vehicle
import ai.pleos.playground.vehicle.api.model.area.DoorArea
import ai.pleos.playground.vehicle.api.model.area.SeatArea
import ai.pleos.playground.vehicle.api.model.telltale.Telltales
import ai.pleos.playground.vehicle.constant.area.DoorValue
import ai.pleos.playground.vehicle.constant.area.SeatValue
import ai.pleos.playground.vehicle.constant.control.LightSwitch
import ai.pleos.playground.vehicle.constant.telltale.TelltaleState
import ai.pleos.playground.vehicle.listener.DoorPositionListener
import ai.pleos.playground.vehicle.listener.PowerDownWarningIndicatorListener
import ai.pleos.playground.vehicle.listener.SeatAirbagDeployedListener
import ai.pleos.playground.vehicle.listener.SeatOccupancyListener
import ai.pleos.playground.vehicle.listener.TelltaleInfoListener

/**
 * 실차 신호. Pleos Connect Vehicle SDK(ai.pleos.playground:Vehicle:2.3.2)로
 * 좌석 점유 · 도어 · 경고등 · 출력 제한 경고 · 에어백 전개를 읽고, 미등 · 후방 안개등 · 실내등을 켠다.
 * 속도는 Pleos Vehicle SDK 에 없어 표준 AAOS Car API 로 읽는다.
 *
 * 주의: 이 코드는 SDK 에 맞춰 컴파일까지만 확인했다. Pleos Connect 에뮬레이터·실차에서의 동작은 아직 확인하지 못했다.
 * 아직 붙이지 않은 것: 고속도로 위인지 판단(NaviHelper SDK) — 지금은 항상 고속도로 위라고 가정한다.
 */
class PleosSignalSource(private val context: Context) : VehicleSignalSource {
    override val label = "실차 신호 · Pleos Vehicle SDK"
    override val isDemo = false

    private val handler = Handler(Looper.getMainLooper())
    private var vehicle: Vehicle? = null
    private var car: Car? = null
    private var sink: SignalSink? = null
    private var powerDown = false
    private var telltaleNames: List<String> = emptyList()
    private val savedSwitch = HashMap<String, LightSwitch>()

    override fun start(sink: SignalSink) {
        this.sink = sink
        try {
            val v = Vehicle(context)
            v.initialize()
            vehicle = v
            // 서비스 연결이 끝난 뒤 리스너를 건다
            handler.postDelayed({ guarded("register") { register(v, sink) } }, 1_000)
        } catch (t: Throwable) {
            Log.w(TAG, "Vehicle SDK 초기화 실패", t)
        }
        guarded("speed") { startSpeed(sink) }
    }

    private fun register(v: Vehicle, sink: SignalSink) {
        SEATS.forEachIndexed { i, value ->
            val area = SeatArea(value)
            v.getSeat().getCurrentSeatOccupancy(area, { occ -> post { sink.onSeat(i, occ == true) } }, { })
            v.getSeat().registerSeatOccupancy(area, object : SeatOccupancyListener {
                override fun onSeatOccupancyUpdated(occupied: Boolean?) = post { sink.onSeat(i, occupied == true) }
                override fun onFailed(e: Exception) = Unit
            })
            v.getSafety().registerSeatAirbagDeployed(area, object : SeatAirbagDeployedListener {
                override fun onSeatAirbagDeployUpdated(deployed: Boolean?) {
                    if (deployed == true) post { sink.onAirbagDeployed() }
                }
                override fun onFailed(e: Exception) = Unit
            })
        }
        DOORS.forEach { (key, value) ->
            val area = DoorArea(value)
            v.getDoor().getCurrentDoorPosition(area, { pos -> post { sink.onDoor(key, (pos ?: 0) > 0) } }, { })
            v.getDoor().registerDoorPosition(area, object : DoorPositionListener {
                override fun onPositionUpdated(position: Int?) = post { sink.onDoor(key, (position ?: 0) > 0) }
                override fun onFailed(e: Exception) = Unit
            })
        }
        v.getSafety().getTelltalesInfo({ t -> onTelltales(t) }, { })
        v.getSafety().registerTelltales(object : TelltaleInfoListener {
            override fun onTelltaleInfoUpdated(telltales: Telltales?) = onTelltales(telltales)
            override fun onFailed(e: Exception) = Unit
        })
        v.getSafety().registerPowerDownWarningIndicator(object : PowerDownWarningIndicatorListener {
            override fun onPowerDownWarningIndicatorUpdated(on: Boolean?) {
                powerDown = on == true
                publishTelltales()
            }
            override fun onFailed(e: Exception) = Unit
        })
    }

    /** 고장을 뜻하는 경고등만 골라 이름을 붙인다. */
    private fun onTelltales(t: Telltales?) {
        telltaleNames = (t?.telltales ?: emptyList())
            .filter { it.state != TelltaleState.OFF }
            .mapNotNull { FAULT_TELLTALES[it.type.name] }
            .distinct()
        publishTelltales()
    }

    private fun publishTelltales() {
        val names = telltaleNames + if (powerDown && "출력 제한 경고" !in telltaleNames) listOf("출력 제한 경고") else emptyList()
        post { sink?.onTelltales(names) }
    }

    /** 표준 AAOS Car API 로 속도를 읽는다 (m/s → km/h). */
    private fun startSpeed(sink: SignalSink) {
        val c = Car.createCar(context) ?: return
        car = c
        val pm = c.getCarManager(Car.PROPERTY_SERVICE) as? CarPropertyManager ?: return
        pm.registerCallback(object : CarPropertyManager.CarPropertyEventCallback {
            override fun onChangeEvent(value: CarPropertyValue<*>) {
                val kmh = (((value.value as? Float) ?: return) * 3.6f).toInt()
                // TODO NaviHelper SDK 로 고속도로 본선·갓길인지 판단한다. 지금은 항상 true 로 둔다.
                post { sink.onSpeed(kmh, true) }
            }
            override fun onErrorEvent(propId: Int, zone: Int) = Unit
        }, VehiclePropertyIds.PERF_VEHICLE_SPEED, CarPropertyManager.SENSOR_RATE_NORMAL)
    }

    override fun setEvacLamps(on: Boolean) {
        val v = vehicle ?: return
        guarded("lamps") {
            if (on) {
                v.getLight().getTailLampLightSwitch({ s -> if (s != null) savedSwitch["tail"] = s }, { })
                v.getLight().getRearFogLightSwitch({ s -> if (s != null) savedSwitch["fog"] = s }, { })
                v.getLight().getCabinLightSwitch({ s -> if (s != null) savedSwitch["cabin"] = s }, { })
                v.getLight().setTailLampLightSwitch(LightSwitch.ON, { }, { })
                v.getLight().setRearFogLightSwitch(LightSwitch.ON, { }, { })
                v.getLight().setCabinLightSwitch(LightSwitch.ON, { }, { })
            } else {
                v.getLight().setTailLampLightSwitch(savedSwitch["tail"] ?: LightSwitch.OFF, { }, { })
                v.getLight().setRearFogLightSwitch(savedSwitch["fog"] ?: LightSwitch.OFF, { }, { })
                v.getLight().setCabinLightSwitch(savedSwitch["cabin"] ?: LightSwitch.OFF, { }, { })
            }
        }
    }

    override fun stop() {
        handler.removeCallbacksAndMessages(null)
        guarded("release") { vehicle?.release() }
        guarded("car") { car?.disconnect() }
        vehicle = null
        car = null
        sink = null
    }

    private fun post(block: () -> Unit) { handler.post(block) }

    private inline fun guarded(what: String, block: () -> Unit) {
        try { block() } catch (t: Throwable) { Log.w(TAG, "$what 실패", t) }
    }

    companion object {
        private const val TAG = "PleosSignalSource"

        /** Pleos 차량 서비스가 이 기기에 있는지. 없으면 시연 신호를 쓴다. */
        fun isAvailable(context: Context): Boolean = try {
            context.packageManager
                .queryIntentServices(Intent("ai.pleos.playground.vehicle.VEHICLE_START"), 0)
                .isNotEmpty()
        } catch (t: Throwable) { false }

        // 좌측 운전석 기준
        private val SEATS = listOf(
            SeatValue.ROW_1_LEFT, SeatValue.ROW_1_RIGHT,
            SeatValue.ROW_2_LEFT, SeatValue.ROW_2_CENTER, SeatValue.ROW_2_RIGHT,
        )
        private val DOORS = listOf(
            "fl" to DoorValue.ROW_1_LEFT, "fr" to DoorValue.ROW_1_RIGHT,
            "rl" to DoorValue.ROW_2_LEFT, "rr" to DoorValue.ROW_2_RIGHT,
        )
        private val FAULT_TELLTALES = mapOf(
            "ENGINE" to "엔진 경고등",
            "ENGINE_OIL_PRESSURE" to "엔진 오일 압력 경고",
            "ENGINE_TEMPERATURE" to "냉각수 온도 경고",
            "EV_SYSTEM" to "EV 시스템 경고",
            "LOW_VOLT_BATTERY" to "배터리 경고",
            "POWER_DOWN" to "출력 제한 경고",
            "MASTER_WARNING" to "통합 경고등",
        )
    }
}
